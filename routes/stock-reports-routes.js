const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const stockReportsController = require('../controllers/stock-reports-controller');

// Stock Summary Report - GET (initial load)
router.get('/summary', isLoginEnsured, function (req, res, next) {
    req.body.reportDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    stockReportsController.getStockSummaryReport(req, res, next);
});

// Stock Summary Report - POST (form submit / PDF generation)
router.post('/summary', isLoginEnsured, function (req, res, next) {
    stockReportsController.getStockSummaryReport(req, res, next);
});

// Stock Ledger Report - GET (initial load)
router.get('/ledger', isLoginEnsured, function (req, res, next) {
    req.body.fromDate = new Date(Date.now());
    req.body.toDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    stockReportsController.getStockLedgerReport(req, res, next);
});

// Stock Ledger Report - POST (form submit / PDF generation)
router.post('/ledger', isLoginEnsured, function (req, res, next) {
    stockReportsController.getStockLedgerReport(req, res, next);
});

module.exports = router;