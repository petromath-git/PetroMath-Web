// routes/adjustment-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const adjustmentController = require('../controllers/adjustment-controller');

// Route to display the adjustment entry page (GET)
router.get('/', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAdjustmentEntryPage(req, res, next);
});

// Route to save adjustment entry (POST)
router.post('/', isLoginEnsured, function (req, res, next) {
    adjustmentController.saveAdjustment(req, res, next);
});

// API endpoint to get account lists by type (AJAX calls)
router.get('/api/accounts/:accountType', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAccountsByType(req, res, next);
});

// API endpoint to get adjustment types
router.get('/api/adjustment-types', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAdjustmentTypes(req, res, next);
});

// Route to display adjustment list/history page
router.get('/list', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAdjustmentList(req, res, next);
});

// API endpoint for adjustment list (with filters)
router.post('/api/list', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAdjustmentListAPI(req, res, next);
});

// Route to view specific adjustment details
router.get('/:adjustmentId', isLoginEnsured, function (req, res, next) {
    adjustmentController.getAdjustmentDetails(req, res, next);
});

// Route to reverse an adjustment (admin only)
router.post('/:adjustmentId/reverse', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    adjustmentController.reverseAdjustment(req, res, next);
});

// API endpoint for AJAX reversal
router.post('/api/:adjustmentId/reverse', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    adjustmentController.reverseAdjustmentAPI(req, res, next);
});

// Future: Export adjustments to Excel
router.post('/export/excel', isLoginEnsured, function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Excel export feature is coming soon'
    });
});

module.exports = router;