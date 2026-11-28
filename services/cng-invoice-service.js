// services/cng-invoice-service.js — CNG purchase invoices (tkt #481).
//
// A CNG invoice is an ordinary Purchase Invoice (t_tank_invoice, fuel_category 'CNG', line in KG) with no
// tank receipt or decant: the oil company fills the CNG cascade itself. This file holds what the bulk upload
// and the IOCL mail import share: read one PDF, check it is this bunk's CNG invoice, save it unless its
// number is already in. An existing invoice is never overwritten (TankInvoiceDao.saveInvoice would).
const db = require('../db/db-connection');
const TankInvoiceDao = require('../dao/tank-invoice-dao');

// The bunk's CNG product (a tank product named CNG), or null when the bunk does not sell CNG.
async function findCngProduct(locationCode) {
    const rows = await db.sequelize.query(
        `SELECT product_id, product_name FROM m_product
         WHERE location_code = :locationCode AND is_tank_product = 1 AND UPPER(TRIM(product_name)) = 'CNG'
         ORDER BY product_id LIMIT 1`,
        { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
    );
    return rows[0] || null;
}

// One PDF -> { status: IMPORTED | EXISTS | ERROR, invoice_number, invoice_date, quantity, amount, invoice_id, detail }.
// ERROR carries a reason a person can act on; a DB failure is thrown.
async function importCngPdf(locationCode, buffer, fileName) {
    // required here, not at the top: tank-receipt-controller requires this file
    const { parseInvoiceForLocation, tempInvoiceStore } = require('../controllers/tank-receipt-controller');

    let parsed;
    try {
        parsed = await parseInvoiceForLocation(locationCode, buffer, fileName);
    } catch (e) {
        return { status: 'ERROR', detail: e.message };
    }
    const body = parsed.body || {};
    if (body.tempId) tempInvoiceStore.delete(body.tempId);
    if (!body.success) return { status: 'ERROR', detail: body.error || 'Could not read the PDF.' };
    if (!body.is_cng) return { status: 'ERROR', detail: 'Not a CNG invoice. Upload MS/HSD invoices through New Purchase > Fuel Invoice.' };

    const h = body.data.header || {};
    const lines = body.data.lines || [];
    const out = {
        invoice_number: h.invoice_number || null,
        invoice_date: h.invoice_date || null,
        quantity: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
        amount: h.total_invoice_amount != null ? Number(h.total_invoice_amount) : null,
    };
    if (!out.invoice_number || !out.invoice_date || !lines.length) {
        return { ...out, status: 'ERROR', detail: 'Invoice number, date or line missing in the PDF.' };
    }

    const existing = await TankInvoiceDao.findByInvoiceNumber(locationCode, out.invoice_number);
    if (existing) return { ...out, status: 'EXISTS', invoice_id: existing.id, detail: 'Already entered.' };

    const saveLines = lines.map(l => ({
        product_id: Number(body.mappings[l.product_name]),
        product_name: l.product_name,
        quantity: l.quantity,
        qty_unit: 'KG',
        rate_per_kl: l.rate_per_kl || null,
        density: null,
        hsn_code: l.hsn_code || null,
        total_line_amount: l.total_line_amount || null,
        charges: l.charges || []
    }));
    if (saveLines.some(l => !l.product_id)) return { ...out, status: 'ERROR', detail: 'No product to map the CNG line to.' };

    const header = {
        location_id: locationCode,
        supplier_id: Number(body.supplierId),
        supplier: body.supplier,
        invoice_number: out.invoice_number,
        invoice_date: out.invoice_date,
        truck_number: null,
        delivery_doc_no: h.delivery_doc_no || null,
        seal_lock_no: null,
        bay_number: null,
        total_invoice_amount: out.amount,
        fuel_category: 'CNG'
    };
    const inv = await TankInvoiceDao.saveInvoice(header, saveLines, buffer, locationCode, header.supplier_id, fileName);
    return { ...out, status: 'IMPORTED', invoice_id: inv.id, detail: 'Saved.' };
}

module.exports = { findCngProduct, importCngPdf };
