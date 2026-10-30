// GST self-filing pages beside GSTR-1 (/gst/gstr1): HSN codes, reverse-charge entries,
// GSTR-2B upload with the ITC / Rule 42 working, and the GSTR-3B worksheet.
const moment = require('moment');
const GstConfigDao = require('../dao/gst-config-dao');
const GstFilingDao = require('../dao/gst-filing-dao');
const GstItcService = require('../services/gst-itc-service');
const GstHsnService = require('../services/gst-hsn-service');
const GstWorkbookService = require('../services/gst-workbook-service');
const LocationDao = require('../dao/location-dao');
const Gstr3bWorksheetService = require('../services/gstr3b-worksheet-service');
const gstUtils = require('../utils/gst-utils');

const userOf = (req) => req.user.Person_id || req.user.username;
const periodOf = (value) => gstUtils.isValidReturnPeriod(value) ? value : gstUtils.getCurrentReturnPeriod();
const r2 = (n) => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100;
const isValidHsn = (hsn) => /^\d{4}(\d{2}(\d{2})?)?$/.test(hsn || '');
const isValidDocNo = (no) => /^[A-Za-z0-9\/-]{1,16}$/.test(no || '');
const GST_RATES = [0, 5, 12, 18, 28, 40];

// Self-invoice number: RCM-<month of the financial year>, as the auditor numbers them (Sep = RCM-06).
function defaultSelfInvoiceNo(returnPeriod) {
    const month = parseInt(returnPeriod.substring(0, 2), 10);
    return `RCM-${String(((month + 8) % 12) + 1).padStart(2, '0')}`;
}

function rcmRowFrom(body, locationCode, returnPeriod, user) {
    const taxable = r2(body.taxable_value);
    const rate = parseFloat(body.gst_rate);
    const row = {
        rcm_id: body.rcm_id ? parseInt(body.rcm_id, 10) : null,
        location_code: locationCode,
        return_period: returnPeriod,
        supplier_name: String(body.supplier_name || '').trim().substring(0, 150),
        description: String(body.description || '').trim().substring(0, 200),
        sac_code: String(body.sac_code || '').trim().substring(0, 8) || null,
        taxable_value: taxable,
        gst_rate: rate,
        igst: 0,
        cgst: r2(taxable * rate / 200),
        sgst: r2(taxable * rate / 200),
        self_invoice_no: String(body.self_invoice_no || '').trim().toUpperCase(),
        self_invoice_date: body.self_invoice_date,
        itc_class: GstItcService.ITC_CLASSES[body.itc_class] ? body.itc_class : 'COMMON',
        notes: String(body.notes || '').trim().substring(0, 255) || null,
        user
    };
    const { from_date, to_date } = gstUtils.getPeriodDates(returnPeriod);
    if (!row.supplier_name || !row.description) return { error: 'Enter who the supply is from and what it is.' };
    if (!(taxable > 0)) return { error: 'Enter the value before tax.' };
    if (!GST_RATES.includes(rate)) return { error: 'Pick a GST rate.' };
    if (!isValidDocNo(row.self_invoice_no)) return { error: 'Self-invoice number: up to 16 letters, digits, / or -.' };
    if (!moment(row.self_invoice_date, 'YYYY-MM-DD', true).isValid() ||
        moment(row.self_invoice_date).isBefore(from_date) || moment(row.self_invoice_date).isAfter(to_date)) {
        return { error: 'Self-invoice date must be in the month being filed.' };
    }
    return { row };
}

module.exports = {
    // ---------- HSN codes ----------
    getHsn: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const [products, master, defaults, resolver] = await Promise.all([
                GstFilingDao.getProductsForHsn(locationCode),
                GstFilingDao.getHsnMaster(),
                GstFilingDao.getHsnDefaults(),
                GstHsnService.loadResolver()
            ]);
            const desc = new Map(master.map(h => [h.hsn_code, h.description]));
            products.forEach(p => {
                // What the returns use: own code when it is in the list, else reference outlet / category default.
                const used = resolver.resolve(p);
                const fallback = resolver.resolve(Object.assign({}, p, { hsn_code: '' }));
                p.used = used;
                p.suggested = fallback.source !== 'none' ? fallback : null;
                p.valid = isValidHsn(used.code);
                p.description = desc.get(used.code) || null;
            });
            res.render('gst/hsn', {
                title: 'HSN codes', user: req.user, mobileReady: true, products, master, defaults,
                referenceLocations: GstHsnService.REFERENCE_LOCATIONS
            });
        } catch (error) {
            console.error('Error loading HSN codes:', error);
            req.flash('error', 'Could not load HSN codes: ' + error.message);
            res.redirect('/gst');
        }
    },

    // Product codes: only the rows that changed are posted (hsn[<product_id>]).
    saveProductHsn: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const codes = req.body.hsn || {};
            const bad = Object.entries(codes).filter(([, code]) => code && !isValidHsn(String(code).trim()));
            if (bad.length) {
                req.flash('error', `HSN must be 4, 6 or 8 digits. Nothing was saved (${bad.length} wrong).`);
                return res.redirect('/gst/hsn');
            }
            let n = 0;
            for (const [productId, code] of Object.entries(codes)) {
                await GstFilingDao.updateProductHsn(locationCode, parseInt(productId, 10), String(code || '').trim() || null, userOf(req));
                n++;
            }
            req.flash('success', `HSN saved for ${n} product${n === 1 ? '' : 's'}. New bills use it; GSTR-1 uses it for the whole month.`);
            res.redirect('/gst/hsn');
        } catch (error) {
            console.error('Error saving product HSN:', error);
            req.flash('error', 'Could not save: ' + error.message);
            res.redirect('/gst/hsn');
        }
    },

    // Default HSN per product category (used when neither the product nor a reference outlet has one).
    saveHsnDefaults: async (req, res) => {
        try {
            const codes = req.body.def || {};
            const bad = Object.values(codes).filter(c => !isValidHsn(String(c).trim()));
            if (bad.length) {
                req.flash('error', 'Default HSN must be 4, 6 or 8 digits. Nothing was saved.');
                return res.redirect('/gst/hsn');
            }
            for (const [category, code] of Object.entries(codes)) {
                await GstFilingDao.saveHsnDefault(category, String(code).trim(), userOf(req));
            }
            req.flash('success', 'Default HSN codes saved.');
            res.redirect('/gst/hsn');
        } catch (error) {
            console.error('Error saving HSN defaults:', error);
            req.flash('error', 'Could not save: ' + error.message);
            res.redirect('/gst/hsn');
        }
    },

    saveHsnMaster: async (req, res) => {
        try {
            const code = String(req.body.hsn_code || '').trim();
            const description = String(req.body.description || '').trim().substring(0, 500);
            if (!isValidHsn(code) || !description) {
                req.flash('error', 'Enter a 4, 6 or 8 digit HSN and its description from the portal.');
                return res.redirect('/gst/hsn');
            }
            await GstFilingDao.saveHsn(code, description, userOf(req));
            req.flash('success', `HSN ${code} saved.`);
            res.redirect('/gst/hsn');
        } catch (error) {
            console.error('Error saving HSN master:', error);
            req.flash('error', 'Could not save: ' + error.message);
            res.redirect('/gst/hsn');
        }
    },

    // ---------- Reverse charge ----------
    getRcm: async (req, res) => {
        const period = periodOf(req.query.period);
        try {
            const locationCode = req.user.location_code;
            const [entries, prevEntries] = await Promise.all([
                GstFilingDao.getRcmEntries(locationCode, period),
                GstFilingDao.getRcmEntries(locationCode, gstUtils.getPreviousReturnPeriod(period))
            ]);
            const found = req.query.edit ? entries.find(e => String(e.rcm_id) === String(req.query.edit)) : null;
            const edit = found ? Object.assign({}, found, { self_invoice_date: moment(found.self_invoice_date).format('YYYY-MM-DD') }) : null;
            res.render('gst/rcm', {
                title: 'Reverse charge',
                mobileReady: true,
                user: req.user,
                period: { code: period, label: gstUtils.formatReturnPeriod(period), ...gstUtils.getPeriodDates(period) },
                periods: gstUtils.getRecentPeriods(12),
                entries,
                prevCount: prevEntries.length,
                edit,
                defaults: { self_invoice_no: defaultSelfInvoiceNo(period), self_invoice_date: gstUtils.getPeriodDates(period).to_date },
                classes: GstItcService.ITC_CLASSES,
                rates: GST_RATES,
                fmtDate: (d) => moment(d).format('DD-MMM-YYYY')
            });
        } catch (error) {
            console.error('Error loading reverse charge:', error);
            req.flash('error', 'Could not load reverse charge entries: ' + error.message);
            res.redirect('/gst');
        }
    },

    saveRcm: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            const { row, error } = rcmRowFrom(req.body, req.user.location_code, period, userOf(req));
            if (error) {
                req.flash('error', error);
                return res.redirect(`/gst/rcm?period=${period}`);
            }
            if (row.rcm_id) await GstFilingDao.updateRcm(row); else await GstFilingDao.insertRcm(row);
            req.flash('success', `Self-invoice ${row.self_invoice_no} saved: CGST ₹${row.cgst} + SGST ₹${row.sgst}.`);
            res.redirect(`/gst/rcm?period=${period}`);
        } catch (error) {
            console.error('Error saving reverse charge:', error);
            req.flash('error', 'Could not save: ' + error.message);
            res.redirect(`/gst/rcm?period=${period}`);
        }
    },

    deleteRcm: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            await GstFilingDao.deleteRcm(req.user.location_code, parseInt(req.params.id, 10));
            req.flash('success', 'Entry deleted.');
        } catch (error) {
            console.error('Error deleting reverse charge:', error);
            req.flash('error', 'Could not delete: ' + error.message);
        }
        res.redirect(`/gst/rcm?period=${period}`);
    },

    // Same entries as last month (rent), with this month's self-invoice number and date.
    copyRcm: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            const locationCode = req.user.location_code;
            const [existing, prev] = await Promise.all([
                GstFilingDao.getRcmEntries(locationCode, period),
                GstFilingDao.getRcmEntries(locationCode, gstUtils.getPreviousReturnPeriod(period))
            ]);
            if (existing.length) {
                req.flash('error', 'This month already has entries. Edit them instead.');
                return res.redirect(`/gst/rcm?period=${period}`);
            }
            const no = defaultSelfInvoiceNo(period);
            const date = gstUtils.getPeriodDates(period).to_date;
            for (const [i, e] of prev.entries()) {
                await GstFilingDao.insertRcm(Object.assign({}, e, {
                    location_code: locationCode, return_period: period,
                    self_invoice_no: prev.length > 1 ? `${no}/${i + 1}` : no,
                    self_invoice_date: date, user: userOf(req)
                }));
            }
            req.flash('success', `Copied ${prev.length} entr${prev.length === 1 ? 'y' : 'ies'} from last month. Check the amount if the rent changed.`);
            res.redirect(`/gst/rcm?period=${period}`);
        } catch (error) {
            console.error('Error copying reverse charge:', error);
            req.flash('error', 'Could not copy: ' + error.message);
            res.redirect(`/gst/rcm?period=${period}`);
        }
    },

    // ---------- GSTR-2B and ITC ----------
    getItc: async (req, res) => {
        const period = periodOf(req.query.period);
        try {
            const w = await Gstr3bWorksheetService.buildWorksheet(req.user.location_code, period);
            res.render('gst/itc', {
                title: 'GSTR-2B and ITC',
                mobileReady: true,
                user: req.user,
                w,
                periods: gstUtils.getRecentPeriods(12),
                fmtDate: (d) => d ? moment(d).format('DD-MMM-YYYY') : '',
                fmtTime: (d) => d ? moment(d).utcOffset(330).format('DD-MMM-YYYY HH:mm') : ''
            });
        } catch (error) {
            console.error('Error loading ITC:', error);
            req.flash('error', 'Could not load ITC: ' + error.message);
            res.redirect('/gst');
        }
    },

    upload2b: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            if (!req.file) {
                req.flash('error', 'Choose the GSTR-2B JSON file.');
                return res.redirect(`/gst/itc?period=${period}`);
            }
            const gstConfig = await GstConfigDao.findByLocationCode(req.user.location_code);
            const parsed = await GstItcService.upload2b(req.user.location_code, period, req.file.buffer,
                gstConfig ? String(gstConfig.gstin).toUpperCase() : null, userOf(req));
            const skipped = parsed.skipped.length ? ` Not read: ${parsed.skipped.join(', ')} (enter those on the portal yourself).` : '';
            req.flash('success', `GSTR-2B loaded: ${parsed.rows.length} line(s).${skipped}`);
        } catch (error) {
            console.error('Error uploading GSTR-2B:', error);
            req.flash('error', error.message);
        }
        res.redirect(`/gst/itc?period=${period}`);
    },

    set2bClass: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            await GstItcService.setClass(req.user.location_code, parseInt(req.body.gst2b_id, 10), req.body.itc_class,
                req.body.all === '1', userOf(req));
        } catch (error) {
            console.error('Error setting ITC class:', error);
            req.flash('error', 'Could not save: ' + error.message);
        }
        res.redirect(`/gst/itc?period=${period}#lines`);
    },

    // ---------- GSTR-3B worksheet ----------
    getGstr3b: async (req, res) => {
        const period = periodOf(req.query.period);
        try {
            const w = await Gstr3bWorksheetService.buildWorksheet(req.user.location_code, period);
            res.render('gst/gstr3b', {
                title: 'GSTR-3B worksheet',
                mobileReady: true,
                user: req.user,
                w,
                periods: gstUtils.getRecentPeriods(12),
                fmtDate: (d) => moment(d).format('DD-MMM-YYYY')
            });
        } catch (error) {
            console.error('Error loading GSTR-3B worksheet:', error);
            req.flash('error', 'Could not build the GSTR-3B worksheet: ' + error.message);
            res.redirect('/gst');
        }
    },

    // "GST Workings" Excel: GSTR-1 and GSTR-3B laid out for filing by hand on the portal.
    downloadWorkings: async (req, res) => {
        const period = periodOf(req.query.period);
        try {
            const locationCode = req.user.location_code;
            const [w, location] = await Promise.all([
                Gstr3bWorksheetService.buildWorksheet(locationCode, period),
                LocationDao.findByLocationCode(locationCode)
            ]);
            const wb = await GstWorkbookService.buildWorkbook(w, (location && location.location_name) || locationCode);
            const label = moment(gstUtils.getPeriodDates(period).from_date).format('MMM-YYYY');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="GST_Workings_${locationCode}_${label}.xlsx"`);
            await wb.xlsx.write(res);
            res.end();
        } catch (error) {
            console.error('Error building GST workings:', error);
            req.flash('error', 'Could not build the GST workings: ' + error.message);
            res.redirect(`/gst/gstr3b?period=${period}`);
        }
    },

    saveGstr3b: async (req, res) => {
        const period = periodOf(req.body.period);
        try {
            const w = await Gstr3bWorksheetService.saveWorksheet(req.user.location_code, period, req.body, userOf(req));
            req.flash('success', `Saved. Credit ledger carried to next month: CGST ₹${w.payment.closing.cgst}, SGST ₹${w.payment.closing.sgst}.`);
        } catch (error) {
            console.error('Error saving GSTR-3B worksheet:', error);
            req.flash('error', 'Could not save: ' + error.message);
        }
        res.redirect(`/gst/gstr3b?period=${period}`);
    }
};
