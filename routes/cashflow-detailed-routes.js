const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const cashflowDetailedController = require('../controllers/reports-cashflow-detailed-controller');

// Route to display the Cashflow Detailed report page (GET)
router.get('/', isLoginEnsured, function (req, res, next) {
    // Set default values for initial page load
    req.body.fromClosingDate = new Date(Date.now());
    req.body.toClosingDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    cashflowDetailedController.getCashflowDetailedReport(req, res, next);
});

// Route to generate Cashflow Detailed report with filters (POST)
router.post('/', isLoginEnsured, function (req, res, next) {
    req.body.caller = 'notpdf';
    cashflowDetailedController.getCashflowDetailedReport(req, res, next);
});

// Route for PDF generation
router.post('/pdf', isLoginEnsured, function (req, res, next) {
    req.body.caller = 'pdf';
    req.body.reportType = 'cashflow-detailed';
    req.body.reportUrl = '/reports-cashflow-detailed';
    cashflowDetailedController.getCashflowDetailedReport(req, res, next);
});

module.exports = router;