// routes/platform-billing-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const controller = require('../controllers/platform-billing-controller');

// ── Location-scoped: any logged-in user sees only their own location's invoices ──

// GET /platform-billing/my-invoices
router.get('/my-invoices', isLoginEnsured, controller.getMyInvoices);

// GET /platform-billing/my-invoices/:invoiceId
router.get('/my-invoices/:invoiceId', isLoginEnsured, controller.getMyInvoiceDetail);

// ── Master (cross-location): requires MANAGE_PLATFORM_BILLING permission ──

// GET /platform-billing
router.get('/', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getMasterList);

// POST /platform-billing/generate
router.post('/generate', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.generateInvoices);

// POST /platform-billing/payments
router.post('/payments', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.recordPayment);

// GET /platform-billing/outstanding/:locationCode
router.get('/outstanding/:locationCode', [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')], controller.getOutstandingForLocation);

module.exports = router;
