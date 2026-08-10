// controllers/platform-billing-controller.js
const dateFormat = require('dateformat');
const pug = require('pug');
const path = require('path');
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
            const locationCode = req.query.locationCode || null;

            const [invoices, locations] = await Promise.all([
                PlatformBillingDao.findAllInvoices(fromPeriod, toPeriod, locationCode),
                LocationDao.findActiveLocations()
            ]);

            res.render('platform-billing/master-list', {
                title: 'Platform Billing',
                invoices,
                locations,
                fromPeriod,
                toPeriod,
                locationCode,
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
            const result = await PlatformBillingSvc.generateInvoicesForPeriod(periodStartDate, userId, {
                locationCode: req.body.locationCode || null,
                generatedDate: req.body.generatedDate || null
            });
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

    // ─── GET /platform-billing/payments (master) ────────────────────────────
    getPayments: async (req, res, next) => {
        try {
            const today = dateFormat(new Date(), 'yyyy-mm-dd');
            const fromDate = req.query.fromDate || dateFormat(
                new Date(new Date().getFullYear(), new Date().getMonth() - 6, 1), 'yyyy-mm-dd'
            );
            const toDate = req.query.toDate || today;
            const locationCode = req.query.locationCode || null;

            const [payments, locations] = await Promise.all([
                PlatformBillingDao.findAllPayments(fromDate, toDate, locationCode),
                LocationDao.findActiveLocations()
            ]);

            res.render('platform-billing/payments', {
                title: 'Payments',
                payments,
                locations,
                fromDate,
                toDate,
                locationCode,
                today,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── GET /platform-billing/plans (master) ───────────────────────────────
    getPlans: async (req, res, next) => {
        try {
            const [plans, locations] = await Promise.all([
                PlatformBillingDao.findAllCurrentBillingPlans(),
                LocationDao.findActiveLocations()
            ]);
            res.render('platform-billing/plans', {
                title: 'Billing Plans',
                plans,
                locations,
                today: dateFormat(new Date(), 'yyyy-mm-dd'),
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── POST /platform-billing/plans (master) ──────────────────────────────
    savePlan: async (req, res) => {
        try {
            const { location_code, plan_duration_months, plan_rate, discount_type, discount_value, effective_start_date, remarks } = req.body;
            if (!location_code || !effective_start_date || plan_rate == null) {
                return res.status(400).json({ error: 'location_code, plan_rate and effective_start_date are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            await PlatformBillingSvc.updateBillingPlan({
                location_code, plan_duration_months, plan_rate, discount_type, discount_value, effective_start_date, remarks
            }, userId);
            res.json({ success: true });
        } catch (err) {
            console.error('PlatformBillingController.savePlan:', err);
            res.status(500).json({ error: 'Failed to save billing plan' });
        }
    },

    // ─── POST /platform-billing/:invoiceId/adjustment (master) ─────────────
    addAdjustment: async (req, res) => {
        try {
            const { description, amount } = req.body;
            if (!description || amount == null) {
                return res.status(400).json({ error: 'description and amount are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            await PlatformBillingSvc.addInvoiceAdjustment(req.params.invoiceId, description, amount, userId);
            res.json({ success: true });
        } catch (err) {
            console.error('PlatformBillingController.addAdjustment:', err);
            res.status(500).json({ error: err.message || 'Failed to add adjustment' });
        }
    },

    // ─── GET /platform-billing/ledger (master) ──────────────────────────────
    getLedger: async (req, res, next) => {
        try {
            const locationCode = req.query.locationCode || null;
            const locations = await LocationDao.findActiveLocations();
            const ledger = locationCode ? await PlatformBillingSvc.getLocationLedger(locationCode) : [];
            res.render('platform-billing/ledger', {
                title: 'Location Ledger',
                ledger,
                locations,
                locationCode,
                user: req.user
            });
        } catch (err) {
            next(err);
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
    },

    // ─── GET /platform-billing/:invoiceId/pdf (master) ──────────────────────
    printInvoicePDF: async (req, res) => {
        let page = null;
        try {
            const invoice = await PlatformBillingDao.findInvoiceForPrint(req.params.invoiceId);
            if (!invoice) {
                return res.status(404).send('Invoice not found');
            }

            const templatePath = path.join(__dirname, '..', 'views', 'platform-billing', 'invoice-print.pug');
            const htmlContent = pug.renderFile(templatePath, { invoice });

            const { getBrowser } = require('../utils/browserHelper');
            const browser = await getBrowser();
            page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 15000 });

            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' }
            });

            await page.close();
            page = null;

            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${invoice.invoice_number}.pdf"`,
                'Content-Length': pdfBuffer.length,
                'Cache-Control': 'no-cache'
            });
            res.end(pdfBuffer, 'binary');
        } catch (err) {
            console.error('PlatformBillingController.printInvoicePDF:', err);
            if (page) { try { await page.close(); } catch (e) {} }
            res.status(500).send('Failed to generate invoice PDF');
        }
    }
};

module.exports = PlatformBillingController;
