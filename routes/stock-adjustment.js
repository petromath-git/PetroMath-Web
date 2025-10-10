const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const stockAdjustmentController = require('../controllers/stock-adjustment-controller');

// Entry form page (Admin/SuperUser only)
router.get('/add', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    stockAdjustmentController.getStockAdjustmentEntryPage(req, res, next);
});

// API endpoint to get current stock (AJAX calls)
router.get('/api/current-stock/:productId', isLoginEnsured, function (req, res, next) {
    stockAdjustmentController.getCurrentStock(req, res, next);
});

// Save entry (Admin/SuperUser only)
router.post('/add', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    stockAdjustmentController.saveStockAdjustment(req, res, next);
});

// API endpoint for adjustment list (with filters)
router.post('/api/list', isLoginEnsured, function (req, res, next) {
    stockAdjustmentController.getStockAdjustmentListAPI(req, res, next);
});

// Main list page
router.get('/', isLoginEnsured, function (req, res, next) {
    stockAdjustmentController.getStockAdjustmentListPage(req, res, next);
});

module.exports = router;