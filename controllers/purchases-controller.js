const db = require('../db/db-connection');
const { Op } = require('sequelize');
const TankInvoiceDao = require('../dao/tank-invoice-dao');
const SupplierDao = require('../dao/supplier-dao');
const locationConfig = require('../utils/location-config');
const utils = require('../utils/app-utils');
const dateFormat = require('dateformat');

module.exports = {

    getList: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const today = utils.currentDate();
            const firstOfMonth = today.substring(0, 7) + '-01';
            const fromDate = req.query.fromDate || firstOfMonth;
            const toDate   = req.query.toDate   || today;
            const typeFilter = req.query.type   || '';

            const [fuelInvoices, lubeInvoices] = await Promise.all([
                TankInvoiceDao.findAll(locationCode, fromDate, toDate),
                db.t_lubes_inv_hdr.findAll({
                    where: {
                        location_code: locationCode,
                        invoice_date: { [Op.between]: [fromDate, toDate] }
                    },
                    include: [{ model: db.m_supplier, as: 'Supplier', attributes: ['supplier_name'] }],
                    order: [['invoice_date', 'DESC'], ['lubes_hdr_id', 'DESC']]
                })
            ]);

            const rows = [];

            if (!typeFilter || typeFilter === 'FUEL') {
                fuelInvoices.forEach(f => {
                    const qty = (f.lines || []).reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
                    rows.push({
                        type: 'FUEL',
                        id: f.id,
                        invoice_date: f.invoice_date,
                        invoice_date_fmt: f.invoice_date ? dateFormat(new Date(f.invoice_date), 'dd-mmm-yyyy') : '',
                        invoice_number: f.invoice_number || '',
                        supplier: f.supplier || '',
                        amount: parseFloat(f.total_invoice_amount) || 0,
                        qty_summary: qty > 0 ? qty.toFixed(3) + ' KL' : '',
                        status: 'SAVED',
                        link: `/purchases/fuel-invoice/${f.id}`
                    });
                });
            }

            if (!typeFilter || typeFilter === 'LUBE') {
                lubeInvoices.forEach(l => {
                    rows.push({
                        type: 'LUBE',
                        id: l.lubes_hdr_id,
                        invoice_date: l.invoice_date,
                        invoice_date_fmt: l.invoice_date ? dateFormat(new Date(l.invoice_date), 'dd-mmm-yyyy') : '',
                        invoice_number: l.invoice_number || '',
                        supplier: l.Supplier ? l.Supplier.supplier_name : '',
                        amount: parseFloat(l.invoice_amount) || 0,
                        qty_summary: '',
                        status: l.closing_status || '',
                        link: `/lubes-invoice?id=${l.lubes_hdr_id}`
                    });
                });
            }

            rows.sort((a, b) => new Date(b.invoice_date) - new Date(a.invoice_date));

            res.render('purchases', {
                user: req.user,
                rows,
                fromDate,
                toDate,
                typeFilter,
                currentDate: today
            });
        } catch (err) {
            next(err);
        }
    },

    getNewFuelInvoice: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const [suppliers, products] = await Promise.all([
                SupplierDao.findSuppliers(locationCode),
                db.sequelize.query(
                    `SELECT product_id, product_name FROM m_product WHERE location_code = :locationCode AND is_tank_product = 1`,
                    { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
                )
            ]);
            res.render('fuel-invoice', {
                user: req.user,
                invoice: null,
                suppliers,
                products,
                currentDate: utils.currentDate(),
                isNew: true,
                editDisabled: false
            });
        } catch (err) {
            next(err);
        }
    },

    getFuelInvoice: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const id = req.params.id;
            const [invoice, suppliers, products, editDisabledCfg] = await Promise.all([
                TankInvoiceDao.findById(id),
                SupplierDao.findSuppliers(locationCode),
                db.sequelize.query(
                    `SELECT product_id, product_name FROM m_product WHERE location_code = :locationCode AND is_tank_product = 1`,
                    { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
                ),
                locationConfig.getLocationConfigValue(locationCode, 'FUEL_INVOICE_EDIT_DISABLED', 'N')
            ]);
            if (!invoice) return res.status(404).send('Invoice not found');
            res.render('fuel-invoice', {
                user: req.user,
                invoice,
                suppliers,
                products,
                currentDate: utils.currentDate(),
                isNew: false,
                editDisabled: String(editDisabledCfg).toUpperCase() === 'Y'
            });
        } catch (err) {
            next(err);
        }
    },

    saveFuelInvoice: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const body = req.body;

            if (!body.supplier_id) return res.status(400).json({ success: false, error: 'Supplier is required.' });
            if (!body.invoice_number || !body.invoice_number.trim()) return res.status(400).json({ success: false, error: 'Invoice number is required.' });

            const header = {
                location_id:          locationCode,
                supplier_id:          Number(body.supplier_id),
                supplier:             body.supplier_name || null,
                invoice_number:       body.invoice_number.trim(),
                invoice_date:         body.invoice_date   || null,
                truck_number:         body.truck_number   || null,
                delivery_doc_no:      body.delivery_doc_no || null,
                seal_lock_no:         body.seal_lock_no   || null,
                total_invoice_amount: body.total_invoice_amount || null
            };

            const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => ({
                product_id:        Number(l.product_id),
                product_name:      l.product_name      || null,
                quantity:          l.quantity          || null,
                rate_per_kl:       l.rate_per_kl       || null,
                density:           l.density           || null,
                hsn_code:          l.hsn_code          || null,
                total_line_amount: l.total_line_amount || null,
                charges: (Array.isArray(l.charges) ? l.charges : [])
                    .filter(c => c.charge_type && c.charge_type.trim())
                    .map(c => ({
                        charge_type:   c.charge_type.trim(),
                        charge_pct:    c.charge_pct    || null,
                        charge_amount: c.charge_amount || null
                    }))
            }));

            if (!lines.length) return res.status(400).json({ success: false, error: 'At least one product line is required.' });
            if (lines.some(l => !l.product_id)) return res.status(400).json({ success: false, error: 'All lines must have a product selected.' });

            const invoice = await TankInvoiceDao.saveInvoice(
                header, lines, null, locationCode, header.supplier_id, null
            );
            return res.json({ success: true, id: invoice.id });
        } catch (err) {
            console.error('saveFuelInvoice error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};
