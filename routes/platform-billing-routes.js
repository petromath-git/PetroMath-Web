// routes/platform-billing-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const multer = require('multer');
const controller = require('../controllers/platform-billing-controller');
const bankReceiptController = require('../controllers/platform-bank-receipt-controller');

// ── Location-scoped: any logged-in user sees only their own location's invoices ──
// Temporarily locked down to MANAGE_PLATFORM_BILLING (SuperUser) — not yet
// rolled out to locations. Data is already location-filtered in the
// controller; this extra gate is so the page isn't reachable by direct URL
// while it's disabled in the menu.

// GET /platform-billing/my-invoices
router.get('/my-invoices', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getMyInvoices);

// GET /platform-billing/my-invoices/:invoiceId
router.get('/my-invoices/:invoiceId', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getMyInvoiceDetail);

// ── Master (cross-location): requires MANAGE_PLATFORM_BILLING permission ──

// GET /platform-billing
router.get('/', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getMasterList);

// POST /platform-billing/generate
router.post('/generate', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.generateInvoices);

// GET /platform-billing/runs
router.get('/runs', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getRuns);

// POST /platform-billing/payments
router.post('/payments', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.recordPayment);

// GET /platform-billing/outstanding/:locationCode
router.get('/outstanding/:locationCode', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getOutstandingForLocation);

// GET /platform-billing/payments
router.get('/payments', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getPayments);

// ── Bank receipts: PetroMath's own IOB statement (tkt #459) ──
const manageBilling = [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')];
const statementUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/\.xlsx?$/i.test(file.originalname)) return cb(null, true);
        cb(new Error('Only Excel (.xls, .xlsx) files are allowed'));
    }
}).single('statementFile');

router.get('/bank-receipts', manageBilling, bankReceiptController.getPage);
router.post('/bank-receipts/upload', manageBilling, (req, res, next) => {
    statementUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, bankReceiptController.upload);
router.post('/bank-receipts/apply-suggestions', manageBilling, bankReceiptController.applySuggestions);
router.post('/bank-receipts/uploads/:id/remove', manageBilling, bankReceiptController.removeUpload);
router.post('/bank-receipts/:id/tag', manageBilling, bankReceiptController.tag);
router.post('/bank-receipts/:id/ignore', manageBilling, bankReceiptController.ignore);
router.post('/bank-receipts/:id/undo', manageBilling, bankReceiptController.undo);

// GET /platform-billing/plans
router.get('/plans', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getPlans);

// POST /platform-billing/plans
router.post('/plans', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.savePlan);

// GET /platform-billing/ledger
router.get('/ledger', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getLedger);

// POST /platform-billing/:invoiceId/adjustment
router.post('/:invoiceId/adjustment', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.addAdjustment);

// GET /platform-billing/:invoiceId/pdf
router.get('/:invoiceId/pdf', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.printInvoicePDF);

module.exports = router;
