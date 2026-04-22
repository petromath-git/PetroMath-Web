const db = require('../db/db-connection');
const { Op } = require('sequelize');
const InvoiceProductMapDao = require('./invoice-product-map-dao');
const DocumentStoreDao = require('./document-store-dao');

const TankInvoice = db.tank_invoice;
const TankInvoiceDtl = db.tank_invoice_dtl;
const TankInvoiceCharges = db.tank_invoice_charges;

module.exports = {

    findAll: (locationId, fromDate, toDate) => {
        const where = { location_id: locationId };
        if (fromDate && toDate) {
            where.invoice_date = { [Op.between]: [fromDate, toDate] };
        }
        return TankInvoice.findAll({
            where,
            include: [{ model: TankInvoiceDtl, as: 'lines', attributes: ['id', 'product_name', 'quantity'] }],
            order: [['invoice_date', 'DESC'], ['id', 'DESC']]
        });
    },

    findById: (id) => {
        return TankInvoice.findByPk(id, {
            include: [{
                model: TankInvoiceDtl,
                as: 'lines',
                include: [{ model: TankInvoiceCharges, as: 'charges' }]
            }]
        });
    },

    deleteById: async (id) => {
        return db.sequelize.transaction(async (t) => {
            const lines = await TankInvoiceDtl.findAll({ where: { invoice_id: id }, transaction: t });
            for (const line of lines) {
                await TankInvoiceCharges.destroy({ where: { invoice_dtl_id: line.id }, transaction: t });
            }
            await TankInvoiceDtl.destroy({ where: { invoice_id: id }, transaction: t });
            await TankInvoice.destroy({ where: { id }, transaction: t });
        }).then(async () => {
            const docs = await DocumentStoreDao.findByEntity('TANK_INVOICE', id);
            for (const doc of docs) await DocumentStoreDao.deleteById(doc.doc_id);
        });
    },

    findByInvoiceNumber: (locationId, invoiceNumber) => {
        return TankInvoice.findOne({
            where: { location_id: locationId, invoice_number: invoiceNumber },
            attributes: { exclude: ['invoice_pdf'] },
            include: [{
                model: TankInvoiceDtl,
                as: 'lines',
                include: [{ model: TankInvoiceCharges, as: 'charges' }]
            }],
            order: [['id', 'DESC']]
        });
    },

    // header: invoice header fields including supplier_id (mandatory)
    // lines: array of { product_id (mandatory), product_name, quantity, ... charges[] }
    // pdfBuffer: Buffer (optional — only on first save / re-upload)
    // locationCode + supplierId: used to persist product mappings
    saveInvoice: async (header, lines, pdfBuffer, locationCode, supplierId, originalFileName) => {
        return db.sequelize.transaction(async (t) => {
            let invoice = null;
            if (header.invoice_number) {
                invoice = await TankInvoice.findOne({
                    where: { location_id: header.location_id, invoice_number: header.invoice_number },
                    transaction: t
                });
            }
            if (invoice) {
                await invoice.update(header, { transaction: t });
                // destroy charges first (FK), then lines
                const existingLines = await TankInvoiceDtl.findAll({ where: { invoice_id: invoice.id }, transaction: t });
                for (const el of existingLines) {
                    await TankInvoiceCharges.destroy({ where: { invoice_dtl_id: el.id }, transaction: t });
                }
                await TankInvoiceDtl.destroy({ where: { invoice_id: invoice.id }, transaction: t });
            } else {
                invoice = await TankInvoice.create(header, { transaction: t });
            }

            for (const line of lines) {
                const { charges, ...lineData } = line;
                lineData.invoice_id = invoice.id;
                const savedLine = await TankInvoiceDtl.create(lineData, { transaction: t });
                if (charges && charges.length > 0) {
                    const chargeRows = charges.map(c => ({ ...c, invoice_dtl_id: savedLine.id }));
                    await TankInvoiceCharges.bulkCreate(chargeRows, { transaction: t });
                }
            }

            return invoice;
        }).then(async (invoice) => {
            // Save PDF to document store (replace existing if re-uploading)
            if (pdfBuffer) {
                const existing = await DocumentStoreDao.findByEntity('TANK_INVOICE', invoice.id);
                for (const doc of existing) await DocumentStoreDao.deleteById(doc.doc_id);
                await DocumentStoreDao.create({
                    entity_type:  'TANK_INVOICE',
                    entity_id:    invoice.id,
                    doc_category: 'PURCHASE_INVOICE',
                    file_name:    originalFileName || 'invoice.pdf',
                    mime_type:    'application/pdf',
                    file_size:    pdfBuffer.length,
                    file_data:    pdfBuffer,
                    location_code: locationCode,
                    created_by:   'system'
                });
            }

            if (supplierId && locationCode) {
                const mappings = lines.map(l => ({ invoice_product_name: l.product_name, product_id: l.product_id }));
                await InvoiceProductMapDao.saveMappings(locationCode, supplierId, mappings).catch(() => {});
            }
            return invoice;
        });
    }
};
