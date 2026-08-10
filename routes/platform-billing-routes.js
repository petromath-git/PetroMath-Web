// routes/platform-billing-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const controller = require('../controllers/platform-billing-controller');

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

// POST /platform-billing/payments
router.post('/payments', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.recordPayment);

// GET /platform-billing/outstanding/:locationCode
router.get('/outstanding/:locationCode', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getOutstandingForLocation);

// GET /platform-billing/payments
router.get('/payments', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getPayments);

// GET /platform-billing/plans
router.get('/plans', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getPlans);

// POST /platform-billing/plans
router.post('/plans', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.savePlan);

// GET /platform-billing/ledger
router.get('/ledger', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getLedger);

// POST /platform-billing/:invoiceId/adjustment
router.post('/:invoiceId/adjustment', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.addAdjustment);

module.exports = router;
