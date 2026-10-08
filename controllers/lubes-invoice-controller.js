const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const lubesInvoiceDao = require("../dao/lubes-invoice-dao");
const supplierDao = require("../dao/supplier-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
const db = require("../db/db-connection");
const LubesInvoiceHeader = db.t_lubes_inv_hdr;
const LubesInvoiceLine = db.t_lubes_inv_lines;
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const InvoiceParserService = require('../services/invoice-parser-service');
const InvoiceProductMapDao = require('../dao/invoice-product-map-dao');
const DocumentStoreDao = require('../dao/document-store-dao');
const locationDao = require('../dao/location-dao');
const moment = require('moment');
const { getLocationConfigValue } = require('../utils/location-config');
const Calc = require('../public/javascripts/lube-invoice-calc');
const path = require('path');

// Short-lived store for uploaded PDF buffers pending user confirmation (30 min TTL)
const tempLubeInvoiceStore = new Map();

// Per-oil-company "how to read your invoice" help (config/lube-invoice-formats/*.json)
const INVOICE_FORMATS = ['IOCL', 'BPCL', 'HPCL', 'GENERIC'];
const invoiceFormatHelp = {};
for (const f of INVOICE_FORMATS) {
    try {
        invoiceFormatHelp[f] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'lube-invoice-formats', `${f}.json`), 'utf8'));
    } catch (e) {
        console.error(`lube-invoice-formats/${f}.json failed to load:`, e.message);
    }
}

const ATTACHMENT_ENTITY = 'LUBE_INVOICE';
const ATTACHMENT_CATEGORY = 'INVOICE_COPY';
const MAX_ATTACHMENTS = 3;


module.exports = {
    getLubesInvoiceHome: (req, res, next) => {
        gatherLubesInvoices(
            req.query.invoice_fromDate,
            req.query.invoice_toDate,
            req.query.supplier_id,
            req.query.invoice_type,
            req.query.fuel_category,
            req.user,
            res,
            next,
            {}
        );
    },
    
    getLubesInvoiceEntry: async (req, res, next) => {
        try {
            const invoice = await lubesInvoiceDao.findLubesInvoice(req.user.location_code, req.query.id);
            if (!invoice || invoice.location_code !== req.user.location_code) {
                return res.status(404).send("Invoice not found");
            }
            const lines = await lubesInvoiceDao.findLubesInvoiceLines(invoice.lubes_hdr_id);
            await renderInvoiceForm(req, res, invoice, lines);
        } catch (err) {
            console.error("Error fetching invoice:", err);
            next(err);
        }
    },

    createNewInvoice: async (req, res, next) => {
        try {
            await renderInvoiceForm(req, res, null, []);
        } catch (err) {
            console.error("Error loading form data:", err);
            next(err);
        }
    },

    // POST /lubes-invoice/save
    // The browser sends what the user typed (qty + unit, gross, discount, GST %,
    // cash discount, printed total). Everything derived — pieces, taxable value,
    // GST split, round-off — is recomputed here with the same shared module the
    // screen uses (public/javascripts/lube-invoice-calc.js); browser-computed
    // amounts are never trusted.
    saveLubesInvoice: async (req, res, next) => {
        const user = req.user;
        const locationCode = user.location_code;
        const b = req.body || {};
        const fail = (status, message, errors) => res.status(status).json({ success: false, message, errors: errors || [message] });

        try {
            const hdrId = b.lubes_hdr_id ? parseInt(b.lubes_hdr_id) : null;
            let existing = null;
            if (hdrId) {
                existing = await LubesInvoiceHeader.findOne({ where: { lubes_hdr_id: hdrId, location_code: locationCode } });
                if (!existing) return fail(404, 'Invoice not found.');
                if (existing.closing_status !== 'DRAFT') return fail(400, 'This invoice is closed and cannot be changed.');
            }

            const invoiceNumber = String(b.invoice_number || '').trim();
            if (!invoiceNumber) return fail(400, 'Please enter the invoice number.');
            if (!b.invoice_date) return fail(400, 'Please enter the invoice date.');

            const supplier = await db.m_supplier.findOne({ where: { supplier_id: parseInt(b.supplier_id) || 0, location_code: locationCode } });
            if (!supplier) return fail(400, 'Please select a supplier.');

            // Earliest allowed date is the location's go-live (first shift), as for
            // adjustments and bank entries. A supplier's start date doesn't restrict
            // dates on or after go-live (suppliers are often added after their first
            // invoices); its end date still does.
            const invDate = String(b.invoice_date).slice(0, 10);
            const goLive = await locationDao.getGoLiveDate(locationCode);
            if (goLive && invDate < goLive) {
                return fail(400, `Invoice date ${moment(invDate).format('DD-MMM-YYYY')} is before this location's PetroMath go-live date (${moment(goLive).format('DD-MMM-YYYY')}). Stock before go-live is covered by opening balances.`);
            }
            const supplierEnd = supplier.effective_end_date ? String(supplier.effective_end_date).slice(0, 10) : null;
            if (supplierEnd && invDate > supplierEnd) {
                return fail(400, `${supplier.supplier_name} is not active after ${moment(supplierEnd).format('DD-MMM-YYYY')}.`);
            }

            const items = Array.isArray(b.items) ? b.items.filter(i => i && i.product_id) : [];
            if (!items.length) return fail(400, 'Please add at least one product.');

            const productIds = [...new Set(items.map(i => parseInt(i.product_id)))];
            const products = await db.product.findAll({ where: { product_id: productIds, location_code: locationCode } });
            const productById = new Map(products.map(p => [p.product_id, p]));

            const errors = [];
            const learnedPack = new Map();   // product_id -> litres/kg per piece learned on this save
            const calcLines = items.map((item, idx) => {
                const n = idx + 1;
                const product = productById.get(parseInt(item.product_id));
                if (!product) { errors.push(`Line ${n}: product not found.`); return null; }

                const enteredQty = parseFloat(item.entered_qty);
                if (!(enteredQty > 0)) errors.push(`Line ${n} (${product.product_name}): enter the quantity.`);

                const measure = Calc.measureUnit(product.unit);
                let uom = ['PCS', 'LTR', 'KG'].includes(item.entered_uom) ? item.entered_uom : 'PCS';
                let qty = enteredQty;
                if (measure) {
                    // Product is itself counted in litres/kg (loose oil, barrels) — no conversion
                    uom = measure === 'L' ? 'LTR' : 'KG';
                } else if (uom !== 'PCS') {
                    let packSize = parseFloat(product.pack_volume) || null;
                    if (!packSize) {
                        const parsed = Calc.parsePackSize(product.product_name);
                        packSize = parsed ? parsed.size : null;
                    }
                    if (!packSize) {
                        const told = parseFloat(item.pack_volume);
                        if (told > 0 && told <= 1000) {
                            packSize = told;
                            learnedPack.set(product.product_id, told);
                        }
                    }
                    if (!packSize) {
                        errors.push(`Line ${n} (${product.product_name}): how many ${uom === 'KG' ? 'kg' : 'litres'} is one piece? Enter the quantity in Nos instead, or tell us the pack size.`);
                    } else {
                        qty = Calc.toPieces(enteredQty, uom, packSize).qty;
                    }
                }
                if (!(qty > 0)) errors.push(`Line ${n} (${product.product_name}): quantity must be more than 0.`);

                const gross = parseFloat(item.gross_amount);
                if (!(gross >= 0)) errors.push(`Line ${n} (${product.product_name}): enter the amount (0 for free stock).`);
                const lineDisc = parseFloat(item.discount_amount) || 0;
                if (lineDisc < 0) errors.push(`Line ${n} (${product.product_name}): discount cannot be negative.`);

                return {
                    product, enteredQty, uom, qty, notes: item.notes || null,
                    mrp: parseFloat(item.mrp) || 0,
                    calc: { qty, gross, line_discount: lineDisc, gst_pct: parseFloat(item.gst_pct) }
                };
            });
            if (errors.length) return fail(400, errors[0], errors);

            const taxType = b.tax_type === 'IGST' ? 'IGST' : 'CGST_SGST';
            const discountMode = b.discount_mode === 'TOTAL' ? 'TOTAL' : 'LINE';
            const cashDiscount = Math.max(0, parseFloat(b.cash_discount) || 0);
            const totalLineDiscount = discountMode === 'TOTAL' ? Math.max(0, parseFloat(b.total_line_discount) || 0) : null;
            const printedTotal = b.printed_total === '' || b.printed_total == null ? null : parseFloat(b.printed_total);

            const result = Calc.compute({
                tax_type: taxType,
                discount_mode: discountMode,
                total_line_discount: totalLineDiscount,
                cash_discount: cashDiscount,
                printed_total: printedTotal,
                lines: calcLines.map(l => l.calc)
            });
            if (result.errors.length) return fail(400, result.errors[0], result.errors);

            const invoiceFormat = INVOICE_FORMATS.includes(b.invoice_format) ? b.invoice_format : null;

            const savedId = await db.sequelize.transaction(async (t) => {
                const headerValues = {
                    invoice_date: b.invoice_date,
                    invoice_number: invoiceNumber,
                    supplier_id: supplier.supplier_id,
                    invoice_amount: result.totals.invoice_amount,
                    cash_discount: cashDiscount,
                    notes: b.notes || null,
                    entry_version: 2,
                    tax_type: taxType,
                    discount_mode: discountMode,
                    total_line_discount: totalLineDiscount,
                    printed_total: result.totals.printed_total,
                    round_off: result.totals.round_off,
                    updated_by: user.Person_id,
                    updation_date: new Date()
                };

                let id;
                if (existing) {
                    id = existing.lubes_hdr_id;
                    // Undo the stock this draft added last time before re-adding — re-saving
                    // a draft used to add its quantities to m_product.qty again every time.
                    const oldLines = await LubesInvoiceLine.findAll({ where: { lubes_hdr_id: id }, transaction: t });
                    for (const ol of oldLines) {
                        await db.product.increment({ qty: -(parseFloat(ol.qty) || 0) }, { where: { product_id: ol.product_id }, transaction: t });
                    }
                    await LubesInvoiceLine.destroy({ where: { lubes_hdr_id: id }, transaction: t });
                    await LubesInvoiceHeader.update(headerValues, { where: { lubes_hdr_id: id }, transaction: t });
                } else {
                    const location = await lubesInvoiceDao.getLocationId(locationCode);
                    const created = await LubesInvoiceHeader.create({
                        ...headerValues,
                        location_id: location ? location.location_id : null,
                        location_code: locationCode,
                        closing_status: 'DRAFT',
                        created_by: user.Person_id,
                        creation_date: new Date()
                    }, { transaction: t });
                    id = created.lubes_hdr_id;
                }

                const rows = calcLines.map((l, i) => {
                    const c = result.lines[i];
                    return {
                        lubes_hdr_id: id,
                        product_id: l.product.product_id,
                        qty: c.qty,
                        entered_qty: l.enteredQty,
                        entered_uom: l.uom,
                        mrp: l.mrp,
                        net_rate: c.net_rate,
                        gross_amount: c.gross_amount,
                        discount_amount: c.discount_amount,
                        cash_discount_amount: c.cash_discount_amount,
                        taxable_value: c.taxable_value,
                        cgst_pct: c.cgst_pct, cgst_amount: c.cgst_amount,
                        sgst_pct: c.sgst_pct, sgst_amount: c.sgst_amount,
                        igst_pct: taxType === 'IGST' ? c.igst_pct : null,
                        igst_amount: taxType === 'IGST' ? c.igst_amount : null,
                        amount: c.amount,
                        notes: l.notes,
                        created_by: user.Person_id,
                        creation_date: new Date()
                    };
                });
                await LubesInvoiceLine.bulkCreate(rows, { transaction: t });

                for (const r of rows) {
                    await db.product.increment({ qty: r.qty }, { where: { product_id: r.product_id }, transaction: t });
                }
                for (const [productId, size] of learnedPack) {
                    await db.product.update({ pack_volume: size }, { where: { product_id: productId, location_code: locationCode }, transaction: t });
                }
                if (invoiceFormat && invoiceFormat !== supplier.invoice_format) {
                    await db.m_supplier.update({ invoice_format: invoiceFormat }, { where: { supplier_id: supplier.supplier_id }, transaction: t });
                }
                return id;
            });

            return res.json({
                success: true,
                message: result.totals.matches
                    ? 'Invoice saved. Total matches the printed invoice.'
                    : 'Invoice saved as draft. Enter the printed total and make it match before closing.',
                lubes_hdr_id: savedId,
                totals: result.totals
            });
        } catch (err) {
            console.error("Error saving invoice:", err);
            return fail(500, 'Failed to save invoice: ' + err.message);
        }
    },

deleteLubesInvoice: async (req, res, next) => {
    if (!req.query.id) return res.status(400).send({ error: 'Invoice ID is required' });
    try {
        const invoice = await LubesInvoiceHeader.findOne({ where: { lubes_hdr_id: parseInt(req.query.id) || 0, location_code: req.user.location_code } });
        if (!invoice) return res.status(404).send({ error: 'Invoice not found.' });
        if (invoice.closing_status !== 'DRAFT') return res.status(400).send({ error: 'Only draft invoices can be deleted.' });

        // Take the draft's quantities back out of m_product.qty (added on save)
        const lines = await LubesInvoiceLine.findAll({ where: { lubes_hdr_id: invoice.lubes_hdr_id } });
        const data = await lubesInvoiceDao.deleteLubesInvoice(invoice.lubes_hdr_id);
        if (data == 1) {
            for (const l of lines) {
                await db.product.increment({ qty: -(parseFloat(l.qty) || 0) }, { where: { product_id: l.product_id } });
            }
            return res.status(200).send({ message: 'Invoice successfully deleted.' });
        }
        return res.status(500).send({ error: 'Invoice deletion failed or not available to delete.' });
    } catch (err) {
        console.error("Error deleting invoice:", err);
        res.status(500).send({ error: 'Error during invoice deletion: ' + err.message });
    }
},

finishInvoice: async (req, res, next) => {
    const wantsJson = req.xhr || (req.headers.accept || '').indexOf('json') > -1;
    const reject = (message) => {
        if (wantsJson) return res.status(400).json({ success: false, message });
        req.flash('error', message);
        return res.redirect('/lubes-invoice-home');
    };
    try {
        const invoice = await LubesInvoiceHeader.findOne({ where: { lubes_hdr_id: parseInt(req.query.id) || 0, location_code: req.user.location_code } });
        if (!invoice) return reject('Invoice not found.');
        if (invoice.closing_status !== 'DRAFT') return reject('This invoice is already closed.');

        // Invoices saved from the redesigned screen can only be closed once the
        // printed total has been entered and matches the lines (within ₹1).
        if (invoice.entry_version === 2) {
            const lines = await LubesInvoiceLine.findAll({ where: { lubes_hdr_id: invoice.lubes_hdr_id } });
            if (!lines.length) return reject('Add at least one product before closing.');
            if (invoice.printed_total == null) return reject('Enter the total printed on the invoice before closing.');
            const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
            const diff = Calc.round2(parseFloat(invoice.printed_total) - linesTotal);
            if (Math.abs(diff) > Calc.TOTAL_TOLERANCE) {
                return reject(`Total does not match the printed invoice (difference ₹${diff.toFixed(2)}). Check quantities, amounts and GST.`);
            }
        }
    } catch (err) {
        console.error("Error validating invoice close:", err);
        return reject('Error during invoice closing: ' + err.message);
    }

    lubesInvoiceDao.finishInvoice(req.query.id).then(
        (data) => {
            if(data == 1) {
                // Check if this is an AJAX request
                if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                    // Respond with JSON for AJAX requests
                    res.status(200).json({
                        success: true,
                        message: 'The invoice has been closed.'
                    });
                } else {
                    // Redirect for normal requests
                    req.flash('success', 'The invoice has been closed.'); // If you use flash messages
                    res.redirect('/lubes-invoice-home');
                }
            } else {
                if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                    res.status(500).json({
                        success: false,
                        message: 'Error while closing the invoice.'
                    });
                } else {
                    req.flash('error', 'Error while closing the invoice.'); // If you use flash messages
                    res.redirect('/lubes-invoice-home');
                }
            }
        }).catch(err => {
            console.error("Error finishing invoice:", err);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                res.status(500).json({
                    success: false,
                    message: 'Error during invoice closing: ' + err.message
                });
            } else {
                req.flash('error', 'Error during invoice closing: ' + err.message); // If you use flash messages
                res.redirect('/lubes-invoice-home');
            }
        });
},
    // Add this to your controller module.exports
getLubesInvoiceLines: (req, res, next) => {
    if (!req.query.id) {
        return res.status(400).json({
            success: false,
            message: 'Invoice ID is required'
        });
    }

    lubesInvoiceDao.findLubesInvoiceLines(req.query.id)
        .then(lines => {
            if (!lines) {

              
                return res.status(404).json({
                    success: false,
                    message: 'No lines found for this invoice'
                });
            }

            console.log(lines);

            // Transform the data to ensure we handle missing Product properly
            const transformedLines = lines.map(line => {
                const lineData = line.toJSON();
                return {
                    ...lineData,
                    amount: parseFloat(lineData.amount) || 0,
                    mrp: parseFloat(lineData.mrp) || 0,
                    net_rate: parseFloat(lineData.net_rate) || 0,
                    qty: parseFloat(lineData.qty) || 0,
                    // Ensure product data is safely accessed
                    product_name: lineData.m_product ? lineData.m_product.product_name : 'Unknown Product',
                    unit: lineData.Product ? lineData.Product.unit : '',
                    price: lineData.Product ? lineData.Product.price : 0
                };
            });

            res.json({
                success: true,
                lines: transformedLines
            });
        })
        .catch(err => {
            console.error("Error fetching invoice lines:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching invoice lines',
                error: err.message
            });
        });
},
getHistoricalData: (req, res, next) => {
    const productId = req.query.productId;
    if (!productId) {
        return res.status(400).json({
            success: false,
            message: 'Product ID is required'
        });
    }

    lubesInvoiceDao.getHistoricalPurchaseData(req.user.location_code, productId)
        .then(history => {
            res.json({
                success: true,
                history: history
            });
        })
        .catch(err => {
            console.error("Error fetching historical data:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching historical data',
                error: err.message
            });
        });
},
// Get suppliers active on a specific date
getSuppliersActiveOnDate: (req, res, next) => {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const locationCode = req.user.location_code;
    
    supplierDao.findSuppliersActiveOnDate(locationCode, date)
        .then(suppliers => {
            res.json({
                success: true,
                suppliers: suppliers
            });
        })
        .catch(err => {
            console.error("Error fetching suppliers for date:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching suppliers for the specified date',
                error: err.message
            });
        });
},

// Get all suppliers with their effective dates for client-side filtering
getSuppliersWithDates: (req, res, next) => {
    const locationCode = req.user.location_code;

    supplierDao.getAllSuppliersWithDates(locationCode)
        .then(suppliers => {
            res.json({
                success: true,
                suppliers: suppliers
            });
        })
        .catch(err => {
            console.error("Error fetching suppliers with dates:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching suppliers with dates',
                error: err.message
            });
        });
},

// Render the PDF upload + review page
getUploadPage: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const [products, suppliers] = await Promise.all([
            lubesInvoiceDao.getProducts(locationCode),
            lubesInvoiceDao.getSuppliers(locationCode)
        ]);
        res.render('lube-invoice-upload', {
            title: 'Upload Lube Invoice',
            user: req.user,
            config,
            products,
            suppliers,
            currentDate: utils.currentDate()
        });
    } catch (err) {
        console.error('Error loading lube upload page:', err);
        next(err);
    }
},

// Parse uploaded lube PDF and return structured data + existing product mappings
parseLubeInvoicePdf: async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No PDF file uploaded.' });
        }

        const locationCode = req.user.location_code;
        const pdfBuffer = fs.readFileSync(req.file.path);
        fs.unlink(req.file.path, () => {});

        const rawText = await InvoiceParserService.extractText(pdfBuffer);
        if (!rawText || rawText.trim().length < 50) {
            return res.status(400).json({ success: false, error: 'No readable text in PDF. File may be a scanned image.' });
        }

        // Log raw text — useful for parser tuning during rollout
        console.log('[LUBE PDF RAW TEXT]\n', rawText);

        // Supplier: user-selected from dropdown takes priority over PDF text detection
        const userSupplierId = req.body.supplierId ? Number(req.body.supplierId) : null;
        let supplierRow = null;
        if (userSupplierId) {
            const rows = await db.sequelize.query(
                `SELECT supplier_id, supplier_name, supplier_short_name FROM m_supplier WHERE supplier_id = :id AND location_code = :loc LIMIT 1`,
                { replacements: { id: userSupplierId, loc: locationCode }, type: db.Sequelize.QueryTypes.SELECT }
            );
            supplierRow = rows[0] || null;
        }
        if (!supplierRow) {
            return res.status(400).json({ success: false, error: 'Supplier not found. Please select a valid supplier.' });
        }

        // Determine parser from supplier short name
        const shortName = (supplierRow.supplier_short_name || '').toUpperCase().trim();
        let parsed;
        if (shortName === 'BPCL' || /BHARAT\s*PETROLEUM/i.test(rawText)) {
            parsed = InvoiceParserService.parseBpclLubeInvoice(rawText);
            parsed.supplierKey = 'BPCL';
        } else {
            return res.status(400).json({ success: false, error: `No lube invoice parser available for supplier "${supplierRow.supplier_name}" yet. BPCL is currently supported.` });
        }

        // Stash PDF buffer (30 min TTL)
        const tempId = uuidv4();
        tempLubeInvoiceStore.set(tempId, { buffer: pdfBuffer, expires: Date.now() + 30 * 60 * 1000 });
        for (const [k, v] of tempLubeInvoiceStore) { if (v.expires < Date.now()) tempLubeInvoiceStore.delete(k); }

        const [products, mappings] = await Promise.all([
            lubesInvoiceDao.getProducts(locationCode),
            InvoiceProductMapDao.getLubesMappings(locationCode, supplierRow.supplier_id)
        ]);

        return res.json({
            success: true,
            supplierKey: parsed.supplierKey,
            supplierId: supplierRow.supplier_id,
            supplierName: supplierRow.supplier_name,
            tempId,
            products,
            mappings,
            data: { header: parsed.header, lines: parsed.lines }
        });
    } catch (err) {
        console.error('Error parsing lube invoice PDF:', err);
        return res.status(500).json({ success: false, error: 'Failed to read invoice: ' + err.message });
    }
},

// Save a lube invoice that was parsed from PDF
saveLubeInvoiceFromPdf: async (req, res, next) => {
    try {
        const { tempId, supplierId, header, lines } = req.body;
        const locationCode = req.user.location_code;

        if (!supplierId) return res.status(400).json({ success: false, error: 'Supplier is required.' });
        if (!lines || !lines.length) return res.status(400).json({ success: false, error: 'At least one product line is required.' });
        if (lines.some(l => !l.product_id)) return res.status(400).json({ success: false, error: 'All lines must have a product selected.' });

        const temp = tempLubeInvoiceStore.get(tempId);
        if (temp) tempLubeInvoiceStore.delete(tempId);

        const location = await lubesInvoiceDao.getLocationId(locationCode);

        const result = await lubesInvoiceDao.saveLubeInvoiceFromPdf({
            locationCode,
            locationId: location ? location.location_id : null,
            supplierId: Number(supplierId),
            header,
            lines,
            createdBy: req.user.Person_id
        });

        // Save updated product mappings (including conversion_factor)
        const mappingsToSave = lines.map(l => ({
            invoice_product_name: l.invoice_product_name,
            product_id: Number(l.product_id),
            conversion_factor: l.conversion_factor != null ? l.conversion_factor : null
        })).filter(m => m.invoice_product_name);

        if (mappingsToSave.length) {
            await InvoiceProductMapDao.saveLubesMappings(locationCode, Number(supplierId), mappingsToSave);
        }

        return res.json({ success: true, lubes_hdr_id: result.lubes_hdr_id });
    } catch (err) {
        console.error('Error saving lube invoice from PDF:', err);
        return res.status(500).json({ success: false, error: 'Failed to save invoice: ' + err.message });
    }
},

// POST /lubes-invoice/:id/attachments  (multipart, field "file")
// A copy of the paper/PDF invoice kept for reference. Allowed on draft and
// closed invoices. Type is decided from the file's own bytes, never its name.
uploadAttachment: async (req, res) => {
    const locationCode = req.user.location_code;
    try {
        const invoice = await LubesInvoiceHeader.findOne({ where: { lubes_hdr_id: parseInt(req.params.id) || 0, location_code: locationCode } });
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
        if (!req.file || !req.file.buffer) return res.status(400).json({ success: false, message: 'No file received.' });

        const maxMb = parseFloat(await getLocationConfigValue(locationCode, 'DOC_MAX_UPLOAD_MB', '5')) || 5;
        if (req.file.size > maxMb * 1024 * 1024) {
            return res.status(400).json({ success: false, message: `File must be ${maxMb} MB or smaller. Photos taken in PetroMath are shrunk automatically.` });
        }

        const kind = detectFileKind(req.file.buffer);
        if (!kind) return res.status(400).json({ success: false, message: 'Only JPG, PNG or PDF files can be attached.' });
        if (kind.mime === 'application/pdf') {
            const problem = pdfSafetyProblem(req.file.buffer);
            if (problem) return res.status(400).json({ success: false, message: problem });
        }

        const existing = await DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, invoice.lubes_hdr_id);
        if (existing.length >= MAX_ATTACHMENTS) {
            return res.status(400).json({ success: false, message: `An invoice can have at most ${MAX_ATTACHMENTS} attachments. Remove one first.` });
        }

        const baseName = String(req.file.originalname || 'invoice').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'invoice';
        const doc = await DocumentStoreDao.create({
            entity_type: ATTACHMENT_ENTITY,
            entity_id: invoice.lubes_hdr_id,
            doc_category: ATTACHMENT_CATEGORY,
            file_name: `${baseName}.${kind.ext}`,
            mime_type: kind.mime,
            file_size: req.file.size,
            file_data: req.file.buffer,
            capture_source: req.body.capture_source === 'CAMERA' ? 'CAMERA' : 'UPLOAD',
            location_code: locationCode,
            created_by: req.user.User_Name
        });
        return res.json({ success: true, attachment: { doc_id: doc.doc_id, file_name: doc.file_name, mime_type: doc.mime_type, url: `/documents/${doc.doc_id}` } });
    } catch (err) {
        console.error('Lube invoice attachment upload error:', err);
        return res.status(500).json({ success: false, message: 'Could not save the attachment.' });
    }
},

// POST /lubes-invoice/:id/attachments/:docId/remove — soft unlink, draft invoices only
removeAttachment: async (req, res) => {
    try {
        const invoice = await LubesInvoiceHeader.findOne({ where: { lubes_hdr_id: parseInt(req.params.id) || 0, location_code: req.user.location_code } });
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
        if (invoice.closing_status !== 'DRAFT') return res.status(400).json({ success: false, message: 'Attachments on a closed invoice cannot be removed.' });

        const doc = await DocumentStoreDao.findMetaById(parseInt(req.params.docId) || 0);
        if (!doc || doc.entity_type !== ATTACHMENT_ENTITY || doc.entity_id !== invoice.lubes_hdr_id) {
            return res.status(404).json({ success: false, message: 'Attachment not found.' });
        }
        await DocumentStoreDao.unlink(doc.doc_id, req.user.User_Name);
        return res.json({ success: true });
    } catch (err) {
        console.error('Lube invoice attachment remove error:', err);
        return res.status(500).json({ success: false, message: 'Could not remove the attachment.' });
    }
}
};

// Recognise a file from its first bytes. Anything else is refused.
function detectFileKind(buf) {
    if (!buf || buf.length < 8) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { mime: 'image/png', ext: 'png' };
    if (buf.slice(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
    return null;
}

// Refuse PDFs that can run code or carry hidden programs. Real invoices never
// have these. Checks the PDF's own structure plus compressed object streams
// (where such entries can otherwise be hidden). Returns a user message, or null.
// Embedded files are allowed only when they are data (Adobe Scan, for one,
// embeds a small JSON of scan details in every PDF it makes).
function pdfSafetyProblem(buf) {
    const zlib = require('zlib');
    const text = buf.toString('latin1');
    const ACTIVE = /\/(JavaScript|JS|Launch|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z0-9])/;
    const SAFE_EMBEDDED = ['application#2fjson', 'application#2fxml', 'text#2fxml', 'text#2fplain'];
    const blocked = 'This PDF contains scripts or embedded programs and cannot be attached. Attach a photo of the invoice instead.';

    const problemIn = (s) => {
        if (ACTIVE.test(s)) return blocked;
        const ef = /\/Type\s*\/EmbeddedFile(?![A-Za-z0-9])/g;
        let e;
        while ((e = ef.exec(s)) !== null) {
            const start = s.lastIndexOf('<<', e.index);
            const end = s.indexOf('>>', e.index);
            const dict = s.slice(start < 0 ? 0 : start, end < 0 ? s.length : end);
            const sub = /\/Subtype\s*\/([^\s/<>\[\]()]+)/.exec(dict);
            if (!sub || SAFE_EMBEDDED.indexOf(sub[1].toLowerCase()) < 0) return blocked;
        }
        return null;
    };

    // Dictionaries outside stream data (stream bytes are compressed/binary and
    // would give false matches)
    const outside = problemIn(text.replace(/stream\r?\n[\s\S]*?endstream/g, ' '));
    if (outside) return outside;

    // Compressed object streams can hold dictionaries too — inflate and check them.
    // If one can't be read (e.g. encrypted), the file can't be vouched for.
    const objStm = /\/Type\s*\/ObjStm[\s\S]{0,600}?stream\r?\n([\s\S]*?)endstream/g;
    let m;
    while ((m = objStm.exec(text)) !== null) {
        let inflated;
        try { inflated = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); }
        catch (e) {
            try { inflated = zlib.inflateRawSync(Buffer.from(m[1], 'latin1').slice(2)).toString('latin1'); }
            catch (e2) { return 'This PDF is locked or could not be checked. Attach a photo of the invoice instead.'; }
        }
        const p = problemIn(inflated);
        if (p) return p;
    }
    return null;
}

// Location's oil company (m_location.company_name) — drives the default help panel
async function getLocationOmc(locationCode) {
    const loc = await db.location.findOne({ attributes: ['location_id', 'company_name'], where: { location_code: locationCode } });
    const omc = loc && loc.company_name ? String(loc.company_name).toUpperCase().trim() : '';
    return { location: loc, omc: INVOICE_FORMATS.includes(omc) ? omc : 'GENERIC' };
}

async function renderInvoiceForm(req, res, invoice, lines) {
    const locationCode = req.user.location_code;
    const [products, suppliers, omcInfo, attachments, maxUploadMb, goLiveDate] = await Promise.all([
        lubesInvoiceDao.getProducts(locationCode),
        lubesInvoiceDao.getSuppliers(locationCode),
        getLocationOmc(locationCode),
        invoice ? DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, invoice.lubes_hdr_id) : Promise.resolve([]),
        getLocationConfigValue(locationCode, 'DOC_MAX_UPLOAD_MB', '5'),
        locationDao.getGoLiveDate(locationCode)
    ]);

    // Plain product data for the screen: GST, selling price and pack size
    // (learned value first, else read from the name)
    const productData = products.map(p => {
        const learned = parseFloat(p.pack_volume) || null;
        const parsed = Calc.parsePackSize(p.product_name);
        return {
            product_id: p.product_id,
            product_name: p.product_name,
            unit: p.unit,
            price: parseFloat(p.price) || 0,
            gst: (parseFloat(p.cgst_percent) || 0) + (parseFloat(p.sgst_percent) || 0),
            measure: Calc.measureUnit(p.unit),
            pack_size: learned || (parsed ? parsed.size : null),
            pack_measure: parsed ? parsed.measure : 'L'
        };
    });

    const supplierFormats = {};
    suppliers.forEach(s => { if (s.invoice_format) supplierFormats[s.supplier_id] = s.invoice_format; });

    // Lines as the screen needs them. Legacy lines (saved before the redesign)
    // have no gross_amount: gross is rebuilt as taxable + discount so the stored
    // taxable value is what the screen shows.
    const lineData = (lines || []).map(l => {
        const taxable = l.taxable_value != null ? parseFloat(l.taxable_value) : null;
        const disc = parseFloat(l.discount_amount) || 0;
        const gross = l.gross_amount != null ? parseFloat(l.gross_amount)
            : taxable != null ? Calc.round2(taxable + disc)
            : Calc.round2((parseFloat(l.qty) || 0) * (parseFloat(l.net_rate) || 0));
        const gstPct = l.igst_pct != null
            ? parseFloat(l.igst_pct)
            : (parseFloat(l.cgst_pct) || 0) + (parseFloat(l.sgst_pct) || 0);
        return {
            product_id: l.product_id,
            entered_qty: l.entered_qty != null ? parseFloat(l.entered_qty) : parseFloat(l.qty),
            entered_uom: l.entered_uom || 'PCS',
            qty: parseFloat(l.qty),
            gross_amount: gross,
            discount_amount: disc,
            cash_discount_amount: parseFloat(l.cash_discount_amount) || 0,
            taxable_value: taxable,
            gst_pct: gstPct,
            gst_amount: Calc.round2((parseFloat(l.cgst_amount) || 0) + (parseFloat(l.sgst_amount) || 0) + (parseFloat(l.igst_amount) || 0)),
            amount: parseFloat(l.amount) || 0,
            mrp: parseFloat(l.mrp) || 0,
            notes: l.notes || ''
        };
    });

    res.render('lubes-invoice', {
        title: invoice ? "Purchase Invoice: " + invoice.invoice_number : "New Purchase Invoice",
        user: req.user,
        config: config,
        invoice: invoice,
        invoiceLines: lineData,
        products: productData,
        suppliers: suppliers,
        location_id: omcInfo.location ? omcInfo.location.location_id : null,
        invoiceStatus: invoice ? invoice.closing_status : 'DRAFT',
        isNew: !invoice,
        isLegacy: !!invoice && invoice.entry_version !== 2,
        locationOmc: omcInfo.omc,
        supplierFormats: supplierFormats,
        formatHelp: invoiceFormatHelp,
        gstRates: Calc.GST_RATES,
        attachments: attachments.map(a => ({ doc_id: a.doc_id, file_name: a.file_name, mime_type: a.mime_type, url: `/documents/${a.doc_id}` })),
        maxAttachments: MAX_ATTACHMENTS,
        maxUploadMb: parseFloat(maxUploadMb) || 5,
        goLiveDate: goLiveDate,   // YYYY-MM-DD or null — earliest allowed invoice date
        mobileReady: true,   // viewport tag + body.mobile-ready: invoice lines stack into cards (m-stack)
        dateFormat: dateFormat
    });
}

function gatherLubesInvoices(fromDate, toDate, supplierId, invoiceType, fuelCategory, user, res, next, messagesOptional) {
    // If no dates provided, use financial year dates
    if(fromDate === undefined || toDate === undefined) {
        const financialYearDates = getFinancialYearDates();
        fromDate = financialYearDates.fromDate;
        toDate = financialYearDates.toDate;
    }

    const { Op } = require('sequelize');
    const TankInvoice = db.tank_invoice;
    const TankInvoiceDtl = db.tank_invoice_dtl;
    const Product = db.product;

    // A fuel category filter only applies when Type=Fuel is explicitly selected;
    // ignore a stray fuel_category param otherwise (e.g. a stale value left over
    // from a hidden form field) so it can never silently suppress Lube results.
    fuelCategory = invoiceType === 'FUEL' ? fuelCategory : '';

    // Only offer the CNG/MS-HSD filter for locations that actually carry a CNG product
    const hasCngPromise = Product.findOne({
        where: {
            location_code: user.location_code,
            is_tank_product: 1,
            product_name: db.Sequelize.where(db.Sequelize.fn('UPPER', db.Sequelize.col('product_name')), 'CNG')
        },
        attributes: ['product_id']
    });

    const suppliersPromise = lubesInvoiceDao.getSuppliers(user.location_code);
    const lubesPromise = invoiceType === 'FUEL'
        ? Promise.resolve([])
        : lubesInvoiceDao.findLubesInvoices(user.location_code, fromDate, toDate, supplierId);

    const fuelWhere = { location_id: user.location_code, invoice_date: { [Op.between]: [fromDate, toDate] } };
    if (fuelCategory) fuelWhere.fuel_category = fuelCategory;
    if (supplierId) fuelWhere.supplier_id = supplierId;
    const fuelPromise = invoiceType === 'LUBE'
        ? Promise.resolve([])
        : TankInvoice.findAll({
            where: fuelWhere,
            include: [{ model: TankInvoiceDtl, as: 'lines', attributes: ['quantity', 'qty_unit'] }],
            order: [['invoice_date', 'DESC'], ['id', 'DESC']]
        });

    Promise.all([suppliersPromise, lubesPromise, fuelPromise, hasCngPromise])
        .then(([suppliers, lubesInvoices, fuelInvoices, cngProduct]) => {
            let invoiceValues = [];

            if (lubesInvoices && lubesInvoices.length > 0) {
                lubesInvoices.forEach(invoice => {
                    invoiceValues.push({
                        type: 'LUBE',
                        lubes_hdr_id: invoice.lubes_hdr_id,
                        invoice_number: invoice.invoice_number,
                        supplier_name: invoice.Supplier ? invoice.Supplier.supplier_name : 'N/A',
                        closing_status: invoice.closing_status,
                        notes: invoice.notes,
                        date: dateFormat(invoice.invoice_date, 'dd-mmm-yyyy'),
                        invoice_date_raw: invoice.invoice_date,
                        amount: parseFloat(invoice.invoice_amount) || 0,
                        total_lines: invoice.LubesInvoiceLines ? invoice.LubesInvoiceLines.length : 0
                    });
                });
            }

            if (fuelInvoices && fuelInvoices.length > 0) {
                fuelInvoices.forEach(f => {
                    const qty = (f.lines || []).reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
                    const qty_unit = (f.lines || []).some(l => l.qty_unit === 'KG') ? 'KG' : 'KL';
                    invoiceValues.push({
                        type: 'FUEL',
                        fuel_id: f.id,
                        invoice_number: f.invoice_number || '',
                        supplier_name: f.supplier || '',
                        closing_status: 'SAVED',
                        notes: '',
                        date: f.invoice_date ? dateFormat(new Date(f.invoice_date), 'dd-mmm-yyyy') : '',
                        invoice_date_raw: f.invoice_date,
                        amount: parseFloat(f.total_invoice_amount) || 0,
                        total_lines: (f.lines || []).length,
                        qty_kl: qty > 0 ? qty.toFixed(3) : '',
                        qty_unit: qty_unit,
                        fuel_category: f.fuel_category || (qty_unit === 'KG' ? 'CNG' : 'MS_HSD')
                    });
                });
            }

            invoiceValues.sort((a, b) => new Date(b.invoice_date_raw) - new Date(a.invoice_date_raw));

            res.render('lubes-invoice-home', {
                title: "Purchases",
                user: user,
                fromDate: fromDate,
                toDate: toDate,
                selectedSupplierId: supplierId,
                selectedType: invoiceType || '',
                selectedFuelCategory: fuelCategory || '',
                hasCngProduct: !!cngProduct,
                suppliers: suppliers,
                invoiceValues: invoiceValues,
                currentDate: utils.currentDate(),
                messages: messagesOptional,
                mobileReady: true   // viewport tag + body.mobile-ready: invoices stack into collapsible cards (m-stack)
            });
        })
        .catch(err => {
            console.error("Error gathering invoices:", err);
            next(err);
        });
}

function formatFinancialYearDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFinancialYearDates(date = new Date()) {
    const currentYear = date.getFullYear();
    const currentMonth = date.getMonth();

    let fromDate, toDate;

    // Financial year starts from April 1st
    if (currentMonth >= 3) { // April (3) to December
        fromDate = new Date(currentYear, 3, 1); // April 1st of current year
        toDate = new Date(currentYear + 1, 2, 31); // March 31st of next year
    } else { // January to March
        fromDate = new Date(currentYear - 1, 3, 1); // April 1st of previous year
        toDate = new Date(currentYear, 2, 31); // March 31st of current year
    }

    return {
        fromDate: formatFinancialYearDate(fromDate),
        toDate: formatFinancialYearDate(toDate)
    };
}