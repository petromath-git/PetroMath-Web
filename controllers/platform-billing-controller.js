// controllers/platform-billing-controller.js
const dateFormat = require('dateformat');
const PlatformBillingDao = require('../dao/platform-billing-dao');
const PlatformBillingSvc = require('../services/platform-billing-service');
const LocationDao = require('../dao/location-dao');

const PlatformBillingController = {

    // ─── GET /platform-billing (master) ────────────────────────────────────
    // Cross-location invoice list, gated by MANAGE_PLATFORM_BILLING permission
    getMasterList: async (req, res, next) => {
        try {
            const today = dateFormat(new Date(), 'yyyy-mm-dd');
            const fromPeriod = req.query.fromPeriod || dateFormat(
                new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1), 'yyyy-mm-dd'
            );
            const toPeriod = req.query.toPeriod || today;

            const [invoices, locations] = await Promise.all([
                PlatformBillingDao.findAllInvoices(fromPeriod, toPeriod),
                LocationDao.findActiveLocations()
            ]);

            res.render('platform-billing/master-list', {
                title: 'Platform Billing',
                invoices,
                locations,
                fromPeriod,
                toPeriod,
                today,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── POST /platform-billing/generate (master) ──────────────────────────
    // Manual trigger: generate invoices for a given month (YYYY-MM-01)
    generateInvoices: async (req, res) => {
        try {
            const periodStartDate = req.body.periodStartDate;
            if (!periodStartDate) {
                return res.status(400).json({ error: 'periodStartDate is required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            const result = await PlatformBillingSvc.generateInvoicesForPeriod(periodStartDate, userId);
            res.json({ success: true, ...result });
        } catch (err) {
            console.error('PlatformBillingController.generateInvoices:', err);
            res.status(500).json({ error: 'Failed to generate invoices' });
        }
    },

    // ─── POST /platform-billing/payments (master) ──────────────────────────
    // Record a payment. If `allocations` is provided, allocate manually;
    // otherwise auto-allocate across the location's oldest outstanding
    // invoices first (bulk / lump-sum payment).
    recordPayment: async (req, res) => {
        try {
            const { location_code, payment_date, amount, payment_mode, reference_number, remarks, allocations } = req.body;
            if (!location_code || !amount || !payment_date) {
                return res.status(400).json({ error: 'location_code, payment_date and amount are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;

            const paymentData = {
                location_code, payment_date, amount, payment_mode, reference_number, remarks,
                created_by: userId
            };

            const payment = Array.isArray(allocations) && allocations.length
                ? await PlatformBillingSvc.recordPayment(paymentData, allocations)
                : await PlatformBillingSvc.recordBulkPayment(paymentData);

            res.json({ success: true, payment_id: payment.payment_id });
        } catch (err) {
            console.error('PlatformBillingController.recordPayment:', err);
            res.status(500).json({ error: err.message || 'Failed to record payment' });
        }
    },

    // ─── GET /platform-billing/outstanding/:locationCode (master) ──────────
    // Outstanding invoices for a location, for the payment-allocation UI
    getOutstandingForLocation: async (req, res) => {
        try {
            const invoices = await PlatformBillingDao.findOutstandingInvoicesForLocation(req.params.locationCode);
            res.json({ success: true, invoices });
        } catch (err) {
            console.error('PlatformBillingController.getOutstandingForLocation:', err);
            res.status(500).json({ error: 'Failed to fetch outstanding invoices' });
        }
    },

    // ─── GET /platform-billing/my-invoices (location) ──────────────────────
    // Location-scoped: every location's own login sees only its own invoices
    getMyInvoices: async (req, res, next) => {
        try {
            const invoices = await PlatformBillingDao.findInvoicesForLocation(req.user.location_code);
            const payments = await PlatformBillingDao.findPaymentsForLocation(req.user.location_code);

            res.render('platform-billing/my-invoices', {
                title: 'My Invoices',
                invoices,
                payments,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── GET /platform-billing/my-invoices/:invoiceId (location) ───────────
    getMyInvoiceDetail: async (req, res, next) => {
        try {
            const invoice = await PlatformBillingDao.findInvoiceById(req.params.invoiceId);
            if (!invoice || invoice.location_code !== req.user.location_code) {
                return res.status(404).send('Invoice not found');
            }
            res.render('platform-billing/invoice-detail', {
                title: `Invoice ${invoice.invoice_number}`,
                invoice,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    }
};

module.exports = PlatformBillingController;
