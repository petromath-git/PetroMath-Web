// controllers/platform-bank-receipt-controller.js
const dateFormat = require('dateformat');
const Dao = require('../dao/platform-bank-receipt-dao');
const Svc = require('../services/platform-bank-receipt-service');
const LocationDao = require('../dao/location-dao');

function dateLabel(value) {
    if (!value) return '';
    return value instanceof Date
        ? dateFormat(value, 'dd-mmm-yyyy')
        : dateFormat(String(value).slice(0, 10) + 'T00:00:00', 'dd-mmm-yyyy');
}

// JSON endpoints share this: a service error is a message for the user
const handle = (name, fn) => async (req, res) => {
    try {
        res.json({ success: true, ...(await fn(req, req.user.User_Name || req.user.Person_Name)) });
    } catch (err) {
        console.error(`PlatformBankReceiptController.${name}:`, err);
        res.status(400).json({ error: err.message || 'Something went wrong' });
    }
};

const PlatformBankReceiptController = {

    // ─── GET /platform-billing/bank-receipts ───────────────────────────────
    getPage: async (req, res, next) => {
        try {
            const status = ['UNTAGGED', 'TAGGED', 'IGNORED', 'ALL'].includes(req.query.status) ? req.query.status : 'UNTAGGED';
            const locationCode = req.query.locationCode || null;

            const [allRows, { payments, invoices, suggestions }, counts, uploads, locations, timings] = await Promise.all([
                Dao.findLines(status === 'ALL' ? null : status),
                Svc.getSuggestions(),
                Dao.countsByStatus(),
                Dao.findRecentUploads(),
                LocationDao.findActiveLocations(),
                Dao.findCurrentBillingTiming()
            ]);

            const locationName = {};
            locations.forEach(l => { locationName[l.location_code] = l.location_name; });

            allRows.forEach(r => {
                r.date_label = dateLabel(r.txn_date);
                r.date_iso = Svc.ymd(r.txn_date);
                r.payer_name = Svc.parseNarration(r.description).payer || r.payer_name;
                const s = suggestions.get(r.bank_txn_id);
                if (r.status === 'UNTAGGED' && s) {
                    r.suggestion = {
                        location_code: s.location_code,
                        location_name: locationName[s.location_code] || s.location_code,
                        payment_id: s.payment_id,
                        payment_label: s.payment ? `#${s.payment_id}, ${dateLabel(s.payment.payment_date)}` : null,
                        pays_for: s.payment ? s.payment.pays_for : s.pays_for,
                        invoice_ids: s.invoice_ids || [],
                        advance: s.advance || 0,
                        review: !!s.review,
                        review_reason: s.review_reason
                    };
                }
            });
            // An untagged line has no location yet, so it filters by the suggested one
            const rows = locationCode
                ? allRows.filter(r => (r.location_code || (r.suggestion && r.suggestion.location_code)) === locationCode)
                : allRows;

            uploads.forEach(u => {
                u.range_label = u.from_date ? `${dateLabel(u.from_date)} to ${dateLabel(u.to_date)}` : '';
            });

            const summary = { UNTAGGED: { n: 0, amount: 0 }, TAGGED: { n: 0, amount: 0 }, IGNORED: { n: 0, amount: 0 } };
            counts.forEach(c => { summary[c.status] = { n: Number(c.n), amount: Number(c.amount) }; });

            res.render('platform-billing/bank-receipts', {
                title: 'Bank Receipts',
                rows,
                uploads,
                locations,
                status,
                locationCode,
                summary,
                unlinkedCount: payments.length,
                // For the Tag dialog: payments not yet connected to the statement
                unlinkedPayments: payments.map(p => ({
                    payment_id: p.payment_id,
                    location_code: p.location_code,
                    date_iso: Svc.ymd(p.payment_date),
                    date_label: dateLabel(p.payment_date),
                    pays_for: p.pays_for,
                    amount: Number(p.amount),
                    remaining: Number(p.remaining),
                    mode: p.payment_mode,
                    reference: p.reference_number
                })),
                outstandingInvoices: invoices.map(i => ({
                    invoice_id: i.invoice_id,
                    location_code: i.location_code,
                    period_start: Svc.ymd(i.period_start_date),
                    period_label: i.period_label,
                    balance: Number(i.balance)
                })),
                billingTiming: Object.fromEntries(timings.map(t => [t.location_code, t.billing_timing])),
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── POST /platform-billing/bank-receipts/upload ───────────────────────
    upload: handle('upload', async (req, userId) => {
        if (!req.file) throw new Error('Please choose the statement file.');
        return Svc.uploadStatement(req.file, userId);
    }),

    // ─── POST /platform-billing/bank-receipts/apply-suggestions ────────────
    applySuggestions: handle('applySuggestions', async (req, userId) => {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (!ids.length) throw new Error('No lines selected.');
        return Svc.applySuggestions(ids, userId);
    }),

    // ─── POST /platform-billing/bank-receipts/:id/tag ──────────────────────
    tag: handle('tag', async (req, userId) => {
        const paymentIds = (Array.isArray(req.body.paymentIds) ? req.body.paymentIds : []).map(Number);
        await Svc.tagLine(Number(req.params.id), {
            locationCode: req.body.locationCode,
            paymentIds,
            invoiceIds: (Array.isArray(req.body.invoiceIds) ? req.body.invoiceIds : []).map(Number),
            rememberText: req.body.rememberText
        }, userId);
    }),

    // ─── POST /platform-billing/bank-receipts/:id/ignore ───────────────────
    ignore: handle('ignore', (req, userId) => Svc.ignoreLine(Number(req.params.id), userId)),

    // ─── POST /platform-billing/bank-receipts/:id/undo ─────────────────────
    undo: handle('undo', (req, userId) => Svc.undoLine(Number(req.params.id), userId)),

    // ─── POST /platform-billing/bank-receipts/uploads/:id/remove ───────────
    // For a wrong file (a statement doesn't carry its account number)
    removeUpload: handle('removeUpload', async (req) => ({
        removed: await Dao.removeUntaggedLines(Number(req.params.id))
    }))
};

module.exports = PlatformBankReceiptController;
