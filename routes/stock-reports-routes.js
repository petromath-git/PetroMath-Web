const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const stockReportsController = require('../controllers/stock-reports-controller');


// Stock Summary Report - GET (initial load)
router.get('/summary', isLoginEnsured, function (req, res, next) {
    const now = new Date();
    req.body.fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    req.body.toDate = now;
    req.body.caller = 'notpdf';
    stockReportsController.getStockSummaryReport(req, res, next);
});

// Stock Summary Report - POST (form submit / PDF generation)
router.post('/summary', isLoginEnsured, function (req, res, next) {
    stockReportsController.getStockSummaryReport(req, res, next);
});

// Stock Summary Excel Export
router.post('/summary/excel', isLoginEnsured, function (req, res, next) {
    stockReportsController.exportStockSummaryExcel(req, res, next);
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

// Intercompany Ledger Report - GET (initial load)
router.get('/intercompany-ledger', isLoginEnsured, function (req, res, next) {
    req.body.fromDate = new Date(Date.now());
    req.body.toDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    stockReportsController.getIntercompanyLedgerReport(req, res, next);
});

// Intercompany Ledger Report - POST (form submit / PDF generation)
router.post('/intercompany-ledger', isLoginEnsured, function (req, res, next) {
    stockReportsController.getIntercompanyLedgerReport(req, res, next);
});

// Tank Variance Report - GET (initial load)
router.get('/tank-variance', isLoginEnsured, function (req, res, next) {
    req.body.fromDate = new Date(Date.now());
    req.body.toDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    stockReportsController.getTankVarianceReport(req, res, next);
});

// Tank Variance Report - POST (form submit / PDF generation)
router.post('/tank-variance', isLoginEnsured, function (req, res, next) {
    stockReportsController.getTankVarianceReport(req, res, next);
});

module.exports = router;
