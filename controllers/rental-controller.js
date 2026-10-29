// controllers/rental-controller.js — rental invoices (/rental), tkt #35
//
// The proprietor's GSTIN also covers the commercial property he rents out, so the
// rent invoices are raised here: tenant master -> monthly drafts (on the 26th) ->
// final (running number, PDF) -> GL via Create Accounting -> Tally export, and into
// GSTR-1 / GST Summary. Rent received is tagged on the rent bank's statement.
const path = require('path');
const pug = require('pug');
const dateFormat = require('dateformat');
const RentalDao = require('../dao/rental-dao');
const gstUtils = require('../utils/gst-utils');
const security = require('../utils/app-security');
const { amountInWords } = require('../utils/amount-in-words');
const einvoice = require('../utils/einvoice');
const RentalService = require('../services/rental-service');
const { MONTHS, round2, monthStart, monthLabel, computeAmounts } = RentalService;

const clean = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    return s === '' ? null : s;
};
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function currentMonth() {
    return dateFormat(new Date(), 'yyyy-mm');
}

// Revisions and the escalation rule are edited only for tenants of this location
async function tenantOr404(req, res) {
    const tenant = await RentalDao.getTenant(req.user.location_code, Number(req.params.id));
    if (!tenant) res.status(404).json({ success: false, error: 'Tenant not found.' });
    return tenant;
}

function validateTenant(body) {
    const d = {
        tenant_name: clean(body.tenant_name),
        tenant_address: clean(body.tenant_address),
        city: clean(body.city),
        pincode: clean(body.pincode) ? clean(body.pincode).replace(/\s/g, '') : null,
        gstin: clean(body.gstin) ? clean(body.gstin).toUpperCase() : null,
        phone: clean(body.phone),
        email: clean(body.email),
        property_address: clean(body.property_address),
        rent_description: (clean(body.rent_description) || 'BUILDING RENT').toUpperCase(),
        sac_code: clean(body.sac_code) || '997212',
        monthly_rent: Number(body.monthly_rent),
        gst_rate: body.gst_rate === '' || body.gst_rate == null ? 18 : Number(body.gst_rate),
        tds_percent: body.tds_percent === '' || body.tds_percent == null ? 0 : Number(body.tds_percent),
        start_date: clean(body.start_date),
        end_date: clean(body.end_date),
        notes: clean(body.notes),
    };
    if (!d.tenant_name) return { error: 'Tenant name is required.' };
    if (d.tenant_name.length > 200) return { error: 'Tenant name must be 200 characters or less.' };
    if (d.gstin && !gstUtils.isGstinCheckDigitValid(d.gstin)) {
        return { error: `GSTIN ${d.gstin} is not valid (format or check digit). Check it against the tenant's GST certificate.` };
    }
    if (d.gstin && d.gstin.substring(0, 2) !== '33') {
        return { error: 'Only Tamil Nadu tenants (GSTIN starting 33) are supported: rent is charged as CGST + SGST.' };
    }
    if (d.pincode && !/^[1-9]\d{5}$/.test(d.pincode)) return { error: 'PIN code must be 6 digits.' };
    if (d.gstin && (!d.city || !d.pincode)) return { error: 'City and PIN code are needed for a tenant with a GSTIN (for the e-invoice).' };
    if (!/^\d{4,8}$/.test(d.sac_code)) return { error: 'SAC code must be 4 to 8 digits.' };
    if (!(d.monthly_rent > 0)) return { error: 'Monthly rent must be more than zero.' };
    if (![0, 5, 12, 18, 28].includes(d.gst_rate)) return { error: 'GST rate must be 0, 5, 12, 18 or 28.' };
    if (!(d.tds_percent >= 0 && d.tds_percent <= 20)) return { error: 'TDS % must be between 0 and 20.' };
    if (!isIsoDate(d.start_date)) return { error: 'Rent start date is required.' };
    if (d.end_date && (!isIsoDate(d.end_date) || d.end_date < d.start_date)) return { error: 'End date must be on or after the start date.' };
    return { data: d };
}

function validateSettings(body) {
    const d = {
        landlord_name: clean(body.landlord_name),
        landlord_address: clean(body.landlord_address),
        landlord_city: clean(body.landlord_city),
        landlord_pincode: clean(body.landlord_pincode) ? clean(body.landlord_pincode).replace(/\s/g, '') : null,
        gstin: clean(body.gstin) ? clean(body.gstin).toUpperCase() : null,
        pan: clean(body.pan) ? clean(body.pan).toUpperCase() : null,
        bank_name: clean(body.bank_name),
        bank_branch: clean(body.bank_branch),
        bank_ifsc: clean(body.bank_ifsc) ? clean(body.bank_ifsc).toUpperCase() : null,
        bank_account_no: clean(body.bank_account_no),
        rent_bank_id: body.rent_bank_id ? Number(body.rent_bank_id) : null,
        last_invoice_no: Number(body.last_invoice_no),
        invoice_day: Number(body.invoice_day),
    };
    if (!d.landlord_name) return { error: 'Landlord name is required.' };
    if (!d.gstin || !gstUtils.isGstinCheckDigitValid(d.gstin)) return { error: 'Landlord GSTIN is not valid (format or check digit).' };
    if (d.pan && d.pan !== d.gstin.substring(2, 12)) return { error: `PAN ${d.pan} does not match the GSTIN (${d.gstin.substring(2, 12)}).` };
    if (d.landlord_pincode && !/^[1-9]\d{5}$/.test(d.landlord_pincode)) return { error: 'Landlord PIN code must be 6 digits.' };
    if (!Number.isInteger(d.last_invoice_no) || d.last_invoice_no < 0) return { error: 'Last invoice number must be a whole number.' };
    if (!Number.isInteger(d.invoice_day) || d.invoice_day < 1 || d.invoice_day > 31) return { error: 'Invoice day must be 1 to 31.' };
    return { data: d };
}

function validateDraft(body, tenant) {
    const invoiceDate = clean(body.invoice_date);
    const description = clean(body.description);
    const taxable = Number(body.taxable_value);
    const gstRate = Number(body.gst_rate);
    const tds = Number(body.tds_amount);
    if (!isIsoDate(invoiceDate)) return { error: 'Invoice date is required.' };
    if (!description) return { error: 'Description is required.' };
    if (!(taxable > 0)) return { error: 'Rent must be more than zero.' };
    if (![0, 5, 12, 18, 28].includes(gstRate)) return { error: 'GST rate must be 0, 5, 12, 18 or 28.' };
    const amounts = computeAmounts(taxable, gstRate, 0);
    if (!(tds >= 0 && tds < amounts.total_amount)) return { error: 'TDS must be zero or more and less than the invoice total.' };
    return {
        data: {
            invoice_date: invoiceDate,
            description: description.toUpperCase(),
            sac_code: clean(body.sac_code) || tenant.sac_code,
            ...amounts,
            tds_amount: round2(tds),
        }
    };
}

function invoiceForPrint(invoice, settings) {
    return {
        ...invoice,
        invoice_date_display: dateFormat(invoice.invoice_date_iso + 'T00:00:00', 'dd/mm/yyyy'),
        tenant_pan: invoice.tenant_gstin ? invoice.tenant_gstin.substring(2, 12) : null,
        landlord_pan: settings.pan || (settings.gstin ? settings.gstin.substring(2, 12) : null),
        amount_words: amountInWords(invoice.total_amount),
        irn_qr_svg: invoice.irn_signed_qr ? einvoice.qrSvg(invoice.irn_signed_qr) : null,
    };
}

const fmtAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Two pages share one view: Rental Invoices (Transactions menu) and Rental Master
// (Masters menu, tenants + settings).
const PAGES = {
    invoices: { title: 'Rental Invoices', basePath: '/rental', tabs: [['invoices', 'Invoices'], ['statement', 'Statement'], ['deleted', 'Deleted']] },
    master:   { title: 'Rental Master', basePath: '/rental/master', tabs: [['tenants', 'Tenants'], ['settings', 'Settings']] },
};

// GET /rental?tab=invoices|statement|deleted&month=YYYY-MM&tenant=&from=&to=  and  GET /rental/master?tab=tenants|settings
async function renderPage(req, res, next, pageKey) {
    const page = PAGES[pageKey];
    try {
        const locationCode = req.user.location_code;
        const settings = await RentalDao.getSettings(locationCode);
        if (!settings) {
            return res.render('rental/home', { title: page.title, page, user: req.user, notSetUp: true });
        }

        const tab = page.tabs.some(t => t[0] === req.query.tab) ? req.query.tab : page.tabs[0][0];
        const month = monthStart(req.query.month) ? req.query.month : currentMonth();
        const periodMonth = monthStart(month);

        const [tenants, banks, invoices, due] = await Promise.all([
            RentalDao.getTenants(locationCode),
            RentalDao.getBanks(locationCode),
            RentalDao.getInvoicesForMonth(locationCode, periodMonth),
            RentalDao.getTenantsDueForMonth(locationCode, periodMonth),
        ]);

        // Statement: one tenant, financial year to date by default
        let statement = null;
        const stTenantId = Number(req.query.tenant) || (tenants[0] && tenants[0].tenant_id);
        if (tab === 'statement' && stTenantId) {
            const fy = gstUtils.getFinancialYear(new Date());
            const fromDate = isIsoDate(req.query.from) ? req.query.from : `${fy.split('-')[0]}-04-01`;
            const toDate = isIsoDate(req.query.to) ? req.query.to : dateFormat(new Date(), 'yyyy-mm-dd');
            const [opening, rows] = await Promise.all([
                RentalDao.getOpeningBalance(locationCode, stTenantId, fromDate),
                RentalDao.getStatement(locationCode, stTenantId, fromDate, toDate),
            ]);
            let balance = opening;
            const lines = rows.map(r => {
                balance = round2(balance + Number(r.debit) - Number(r.credit));
                return { ...r, txn_date_display: dateFormat(r.txn_date, 'dd-mmm-yyyy'), balance };
            });
            statement = {
                tenantId: stTenantId, fromDate, toDate, opening, lines, closing: balance,
                totalDebit: round2(rows.reduce((s, r) => s + Number(r.debit), 0)),
                totalCredit: round2(rows.reduce((s, r) => s + Number(r.credit), 0)),
                totalTds: round2(rows.reduce((s, r) => s + Number(r.tds), 0)),
            };
        }

        const deletedInvoices = tab === 'deleted' ? await RentalDao.getDeletedInvoices(locationCode) : [];

        const live = invoices.filter(i => i.status !== 'CANCELLED');
        res.render('rental/home', {
            title: page.title,
            page,
            canInvoice: security.hasMenuChk(req.user, 'RENTAL_INVOICES'),
            canMaster: security.hasMenuChk(req.user, 'RENTAL_MASTER'),
            user: req.user,
            mobileReady: true,
            tab, month, settings, tenants, banks, invoices, due, statement, deletedInvoices,
            monthLabel: `${MONTHS[Number(month.split('-')[1]) - 1]} ${month.split('-')[0]}`,
            totals: {
                taxable: round2(live.reduce((s, i) => s + Number(i.taxable_value), 0)),
                gst: round2(live.reduce((s, i) => s + Number(i.cgst_amount) + Number(i.sgst_amount), 0)),
                total: round2(live.reduce((s, i) => s + Number(i.total_amount), 0)),
            },
            draftCount: invoices.filter(i => i.status === 'DRAFT').length,
            fmtAmt,
            fmtDate: (d) => d ? dateFormat(d, 'dd-mmm-yyyy') : '',
            isoDate: (d) => d ? dateFormat(d, 'yyyy-mm-dd') : '',
            gstinOk: settings.gstin ? gstUtils.isGstinCheckDigitValid(settings.gstin) : false,
            // B2B final invoices still to be e-invoiced on the portal
            einvoicePending: invoices.filter(i => i.status === 'FINAL' && i.tenant_gstin && !i.irn),
        });
    } catch (e) {
        next(e);
    }
}

module.exports = {
    getPage: (req, res, next) => renderPage(req, res, next, 'invoices'),
    getMasterPage: (req, res, next) => renderPage(req, res, next, 'master'),

    saveSettings: async (req, res) => {
        try {
            const v = validateSettings(req.body);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            const locationCode = req.user.location_code;
            if (v.data.rent_bank_id) {
                const banks = await RentalDao.getBanks(locationCode);
                if (!banks.some(b => b.bank_id === v.data.rent_bank_id)) {
                    return res.status(400).json({ success: false, error: 'Rent bank is not an active bank of this location.' });
                }
            }
            await RentalDao.saveSettings(locationCode, v.data, req.user.User_Name);
            await RentalDao.syncReceiptRules(locationCode, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental saveSettings:', e);
            res.status(500).json({ success: false, error: 'Could not save settings.' });
        }
    },

    createTenant: async (req, res) => {
        try {
            const v = validateTenant(req.body);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            const locationCode = req.user.location_code;
            if (await RentalDao.tenantNameExists(locationCode, v.data.tenant_name)) {
                return res.status(400).json({ success: false, error: `Tenant "${v.data.tenant_name}" already exists.` });
            }
            const id = await RentalDao.createTenant(locationCode, v.data, req.user.User_Name);
            res.json({ success: true, tenant_id: id });
        } catch (e) {
            console.error('Rental createTenant:', e);
            res.status(400).json({ success: false, error: e.message || 'Could not add tenant.' });
        }
    },

    updateTenant: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const tenantId = Number(req.params.id);
            const tenant = await RentalDao.getTenant(locationCode, tenantId);
            if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found.' });
            const v = validateTenant(req.body);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            const tenants = await RentalDao.getTenants(locationCode);
            const hasInvoices = Number((tenants.find(x => x.tenant_id === tenantId) || {}).invoice_count) > 0;
            if (v.data.tenant_name !== tenant.tenant_name) {
                if (hasInvoices) {
                    return res.status(400).json({ success: false, error: 'The name can\'t be changed once invoices are raised (it is the ledger and bank receipt name).' });
                }
                if (await RentalDao.tenantNameExists(locationCode, v.data.tenant_name, tenantId)) {
                    return res.status(400).json({ success: false, error: `Tenant "${v.data.tenant_name}" already exists.` });
                }
            }
            // Once invoiced, the rent changes only through Rent → revisions / escalation
            if (hasInvoices) v.data.monthly_rent = Number(tenant.monthly_rent);
            await RentalDao.updateTenant(locationCode, tenantId, v.data, req.user.User_Name, !hasInvoices);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental updateTenant:', e);
            res.status(500).json({ success: false, error: 'Could not save tenant.' });
        }
    },

    deleteTenant: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const tenantId = Number(req.params.id);
            const tenants = await RentalDao.getTenants(locationCode);
            const t = tenants.find(x => x.tenant_id === tenantId);
            if (!t) return res.status(404).json({ success: false, error: 'Tenant not found.' });
            if (Number(t.invoice_count) > 0) {
                return res.status(400).json({ success: false, error: 'This tenant has invoices. Set an end date instead of deleting.' });
            }
            await RentalDao.deleteTenant(locationCode, tenantId);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental deleteTenant:', e);
            res.status(500).json({ success: false, error: 'Could not delete tenant.' });
        }
    },

    // POST /rental/api/generate { month } — one draft per active tenant without one,
    // at the rent in force for that month (after any escalation due by then)
    generateDrafts: async (req, res) => {
        try {
            if (!monthStart(req.body.month)) return res.status(400).json({ success: false, error: 'Pick a month.' });
            const created = await RentalService.createDraftsForMonth(req.user.location_code, req.body.month, req.user.User_Name);
            res.json({ success: true, created: created.length });
        } catch (e) {
            console.error('Rental generateDrafts:', e);
            res.status(500).json({ success: false, error: 'Could not generate invoices.' });
        }
    },

    // GET /rental/api/tenants/:id/rent — revisions + escalation rule
    getRent: async (req, res) => {
        try {
            const tenant = await tenantOr404(req, res);
            if (!tenant) return;
            const [revisions, rule] = await Promise.all([RentalDao.getRevisions(tenant.tenant_id), RentalDao.getEscalation(tenant.tenant_id)]);
            res.json({
                success: true,
                revisions: revisions.map(r => ({ ...r, month_label: monthLabel(r.effective_from), used: !!Number(r.used) })),
                rule: { ...rule, next_label: rule.escalation_next ? monthLabel(rule.escalation_next) : null },
            });
        } catch (e) {
            console.error('Rental getRent:', e);
            res.status(500).json({ success: false, error: 'Could not load the rent history.' });
        }
    },

    // POST /rental/api/tenants/:id/revisions { month: 'YYYY-MM', monthly_rent, note }
    addRevision: async (req, res) => {
        try {
            const tenant = await tenantOr404(req, res);
            if (!tenant) return;
            const effectiveFrom = monthStart(req.body.month);
            const rent = Number(req.body.monthly_rent);
            if (!effectiveFrom) return res.status(400).json({ success: false, error: 'Pick the month the new rent starts.' });
            if (!(rent > 0)) return res.status(400).json({ success: false, error: 'Rent must be more than zero.' });
            if (effectiveFrom <= tenant.start_month) {
                return res.status(400).json({ success: false, error: 'A revision must start after the tenant\'s first month (edit the tenant to change the opening rent).' });
            }
            if (await RentalDao.hasInvoiceFromMonth(tenant.tenant_id, effectiveFrom)) {
                return res.status(400).json({ success: false, error: 'An invoice is already raised for that month or later. Cancel or delete it first, or start the revision from a later month.' });
            }
            if (await RentalDao.revisionExists(tenant.tenant_id, effectiveFrom)) {
                return res.status(400).json({ success: false, error: 'There is already a rent revision for that month. Delete it first.' });
            }
            await RentalDao.insertRevision(tenant.tenant_id, effectiveFrom, round2(rent), 'REVISION', clean(req.body.note), req.user.User_Name);
            await RentalDao.syncCurrentRent(tenant.tenant_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental addRevision:', e);
            res.status(500).json({ success: false, error: 'Could not save the revision.' });
        }
    },

    // DELETE /rental/api/tenants/:id/revisions/:rid — not the opening rent, not one already invoiced
    deleteRevision: async (req, res) => {
        try {
            const tenant = await tenantOr404(req, res);
            if (!tenant) return;
            const rev = (await RentalDao.getRevisions(tenant.tenant_id)).find(r => r.revision_id === Number(req.params.rid));
            if (!rev) return res.status(404).json({ success: false, error: 'Revision not found.' });
            if (rev.source === 'START') return res.status(400).json({ success: false, error: 'The opening rent can\'t be deleted (edit the tenant instead).' });
            if (Number(rev.used)) return res.status(400).json({ success: false, error: 'Invoices are raised at this rent. Cancel them first.' });
            await RentalDao.deleteRevision(tenant.tenant_id, rev.revision_id);
            await RentalDao.syncCurrentRent(tenant.tenant_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental deleteRevision:', e);
            res.status(500).json({ success: false, error: 'Could not delete the revision.' });
        }
    },

    // PUT /rental/api/tenants/:id/escalation { percent, every_months, next_month } — all blank clears it
    saveEscalation: async (req, res) => {
        try {
            const tenant = await tenantOr404(req, res);
            if (!tenant) return;
            const blank = (v) => v === undefined || v === null || String(v).trim() === '';
            if (blank(req.body.percent) && blank(req.body.every_months) && blank(req.body.next_month)) {
                await RentalDao.setEscalation(tenant.tenant_id, null, null, null, req.user.User_Name);
                return res.json({ success: true });
            }
            const percent = Number(req.body.percent);
            const every = Number(req.body.every_months);
            const next = monthStart(req.body.next_month);
            if (!(percent > 0 && percent <= 100)) return res.status(400).json({ success: false, error: 'Escalation % must be between 0 and 100.' });
            if (!Number.isInteger(every) || every < 1 || every > 120) return res.status(400).json({ success: false, error: 'Escalation every N months must be 1 to 120.' });
            if (!next) return res.status(400).json({ success: false, error: 'Pick the month of the next escalation.' });
            if (await RentalDao.hasInvoiceFromMonth(tenant.tenant_id, next)) {
                return res.status(400).json({ success: false, error: 'An invoice is already raised for that month or later. Set the next escalation after the last invoiced month.' });
            }
            await RentalDao.setEscalation(tenant.tenant_id, round2(percent), every, next, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental saveEscalation:', e);
            res.status(500).json({ success: false, error: 'Could not save the escalation.' });
        }
    },

    updateDraft: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const invoice = await RentalDao.getInvoice(locationCode, Number(req.params.id));
            if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found.' });
            if (invoice.status !== 'DRAFT') return res.status(400).json({ success: false, error: 'Only drafts can be edited. Cancel a final invoice and raise a new one.' });
            const tenant = await RentalDao.getTenant(locationCode, invoice.tenant_id);
            const v = validateDraft(req.body, tenant);
            if (v.error) return res.status(400).json({ success: false, error: v.error });
            await RentalDao.updateDraft(locationCode, invoice.invoice_id, v.data, req.user.User_Name);
            res.json({ success: true });
        } catch (e) {
            console.error('Rental updateDraft:', e);
            res.status(500).json({ success: false, error: 'Could not save the draft.' });
        }
    },

    deleteDraft: async (req, res) => {
        try {
            await RentalDao.deleteDraft(req.user.location_code, Number(req.params.id));
            res.json({ success: true });
        } catch (e) {
            console.error('Rental deleteDraft:', e);
            res.status(500).json({ success: false, error: 'Could not delete the draft.' });
        }
    },

    // POST /rental/api/finalize { invoice_ids: [] }
    finalize: async (req, res) => {
        try {
            const ids = (Array.isArray(req.body.invoice_ids) ? req.body.invoice_ids : []).map(Number).filter(Boolean);
            if (!ids.length) return res.status(400).json({ success: false, error: 'No drafts selected.' });
            const locationCode = req.user.location_code;
            const settings = await RentalDao.getSettings(locationCode);
            if (!gstUtils.isGstinCheckDigitValid(settings.gstin || '')) {
                return res.status(400).json({ success: false, error: 'Fix the landlord GSTIN in Settings before finalising.' });
            }
            const count = await RentalDao.finalizeDrafts(locationCode, ids, req.user.User_Name);
            res.json({ success: true, finalized: count });
        } catch (e) {
            console.error('Rental finalize:', e);
            res.status(500).json({ success: false, error: e.message || 'Could not finalise.' });
        }
    },

    cancelInvoice: async (req, res) => {
        try {
            const reason = clean(req.body.reason);
            if (!reason) return res.status(400).json({ success: false, error: 'Give a reason for cancelling.' });
            const ok = await RentalDao.cancelInvoice(req.user.location_code, Number(req.params.id), reason, req.user.User_Name);
            if (!ok) return res.status(400).json({ success: false, error: 'Only a final invoice can be cancelled.' });
            res.json({ success: true });
        } catch (e) {
            console.error('Rental cancelInvoice:', e);
            res.status(500).json({ success: false, error: 'Could not cancel the invoice.' });
        }
    },

    // POST /rental/api/invoices/:id/delete { reason } — final or cancelled, no IRN; kept in t_rental_invoice_deleted
    deleteFinalInvoice: async (req, res) => {
        try {
            const reason = clean(req.body.reason);
            if (!reason) return res.status(400).json({ success: false, error: 'Give a reason for deleting.' });
            const r = await RentalDao.deleteFinalInvoice(req.user.location_code, Number(req.params.id), reason.slice(0, 300), req.user.User_Name);
            if (r.error) return res.status(400).json({ success: false, error: r.error });
            res.json({ success: true, numberReused: r.numberReused });
        } catch (e) {
            console.error('Rental deleteFinalInvoice:', e);
            res.status(500).json({ success: false, error: 'Could not delete the invoice.' });
        }
    },

    // GET /rental/invoice/:id/pdf — final invoices only (drafts have no number)
    invoicePdf: async (req, res) => {
        let page = null;
        try {
            const locationCode = req.user.location_code;
            const invoice = await RentalDao.getInvoice(locationCode, Number(req.params.id));
            if (!invoice || invoice.status === 'DRAFT') return res.status(404).send('Invoice not found (drafts have no PDF).');
            const settings = await RentalDao.getSettings(locationCode);

            const html = pug.renderFile(path.join(__dirname, '..', 'views', 'rental', 'invoice-print.pug'), {
                invoice: invoiceForPrint(invoice, settings), settings, fmtAmt,
            });

            const { getBrowser } = require('../utils/browserHelper');
            const browser = await getBrowser();
            page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
            const pdf = await page.pdf({
                format: 'A4', landscape: true, printBackground: true,
                margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
            });
            await page.close();
            page = null;

            const safeName = String(invoice.tenant_name || 'tenant').replace(/[^A-Za-z0-9]+/g, '_').substring(0, 40);
            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="Rent_${invoice.invoice_no}_${safeName}.pdf"`,
                'Content-Length': pdf.length,
                'Cache-Control': 'no-cache',
            });
            res.end(pdf, 'binary');
        } catch (e) {
            console.error('Rental invoicePdf:', e);
            if (page) { try { await page.close(); } catch (err) { /* ignore */ } }
            res.status(500).send('Failed to generate invoice PDF');
        }
    },

    // GET /rental/einvoice/json?ids=1,2 — bulk-upload file for einvoice1.gst.gov.in
    // (final B2B invoices without an IRN). Refuses the whole file if any invoice
    // is missing something the IRP needs, so nothing half-uploads.
    einvoiceJson: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
            if (!ids.length) return res.status(400).send('No invoices selected.');
            const settings = await RentalDao.getSettings(locationCode);
            const invoices = (await RentalDao.getFinalInvoicesByIds(locationCode, ids)).filter(i => i.tenant_gstin && !i.irn);
            if (!invoices.length) return res.status(400).send('Nothing to e-invoice: the selected invoices already have an IRN or are B2C.');

            const problems = invoices
                .map(i => ({ no: i.invoice_no, name: i.tenant_name, list: einvoice.einvoiceProblems(i, settings) }))
                .filter(p => p.list.length);
            if (problems.length) {
                return res.status(400).send('Fix these first (Masters → Rental Master):\n' +
                    problems.map(p => `Invoice ${p.no} (${p.name}): ${p.list.join('; ')}`).join('\n'));
            }

            const body = JSON.stringify(invoices.map(i => einvoice.buildEinvoice(i, settings)), null, 2);
            const name = `einvoice_rent_${invoices[0].invoice_no}-${invoices[invoices.length - 1].invoice_no}.json`;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
            res.send(body);
        } catch (e) {
            console.error('Rental einvoiceJson:', e);
            res.status(500).send('Could not build the e-invoice file.');
        }
    },

    // POST /rental/api/einvoice/import (multipart "file") — the portal's result file.
    // Each record is matched by invoice number; the buyer GSTIN must match when given.
    einvoiceImport: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'Choose the result file from the portal.' });
            let records;
            try {
                records = einvoice.parseResultFile(req.file.buffer, req.file.originalname);
            } catch (err) {
                return res.status(400).json({ success: false, error: `Could not read ${req.file.originalname}: ${err.message}` });
            }
            if (!records.length) {
                return res.status(400).json({ success: false, error: 'No IRNs found in that file. Upload the result file downloaded after generating the e-invoices.' });
            }

            const locationCode = req.user.location_code;
            const saved = [], skipped = [];
            let withoutQr = 0;
            for (const rec of records) {
                const inv = await RentalDao.getInvoiceByNo(locationCode, Number(rec.docNo));
                if (!inv || !/^\d+$/.test(rec.docNo)) { skipped.push(`${rec.docNo}: no rental invoice with this number`); continue; }
                if (inv.status !== 'FINAL') { skipped.push(`${rec.docNo}: invoice is ${inv.status.toLowerCase()}`); continue; }
                if (rec.buyerGstin && inv.tenant_gstin && rec.buyerGstin.toUpperCase() !== inv.tenant_gstin) {
                    skipped.push(`${rec.docNo}: buyer GSTIN ${rec.buyerGstin} does not match ${inv.tenant_gstin}`); continue;
                }
                if (inv.irn && inv.irn !== rec.irn) { skipped.push(`${rec.docNo}: already has a different IRN`); continue; }
                await RentalDao.saveIrn(inv.invoice_id, rec, req.user.User_Name);
                if (!rec.signedQr) withoutQr++;
                saved.push(rec.docNo);
            }
            res.json({ success: true, saved, skipped, withoutQr });
        } catch (e) {
            console.error('Rental einvoiceImport:', e);
            res.status(500).json({ success: false, error: 'Could not import the file.' });
        }
    },
};
