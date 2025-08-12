// routes/tally-daybook-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const tallyDaybookReportsController = require('../controllers/reports-tally-daybook-controller');

// Route to display the Tally Daybook report page (GET)
router.get('/', isLoginEnsured, function (req, res, next) {
    // Set default values for initial page load
    req.body.fromClosingDate = new Date(Date.now());
    req.body.toClosingDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    tallyDaybookReportsController.getTallyDaybookReport(req, res, next);
});

// Route to generate and display Tally Daybook report with filters (POST)
router.post('/', isLoginEnsured, function (req, res, next) {
    req.body.caller = 'notpdf';
    tallyDaybookReportsController.getTallyDaybookReport(req, res, next);
});

// API endpoint for AJAX calls (returns JSON data)
router.post('/api', isLoginEnsured, function (req, res, next) {
    tallyDaybookReportsController.getApiTallyDaybookReport(req, res, next);
});

// Route for PDF generation (using your existing generic getPDF method)
router.post('/pdf', isLoginEnsured, function (req, res, next) {
    req.body.caller = 'pdf';
    req.body.reportType = 'tally-daybook';
    req.body.reportUrl = '/reports-tally-daybook';
    tallyDaybookReportsController.getTallyDaybookReport(req, res, next);
});

// Route for Excel export (future enhancement - will use generic Excel export when available)
router.post('/excel', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    // For now, return a message that Excel export will be implemented generically
    res.status(501).json({
        success: false,
        message: 'Excel export will be implemented as a generic feature soon'
    });
});

// Route to get summary data only (lightweight API call)
router.get('/summary', isLoginEnsured, function (req, res, next) {
    tallyDaybookReportsController.getTallyDaybookSummary(req, res, next);
});

// Route for data cleanup (admin only)
router.delete('/cleanup', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    tallyDaybookReportsController.cleanupTallyTempData(req, res, next);
});

module.exports = router;