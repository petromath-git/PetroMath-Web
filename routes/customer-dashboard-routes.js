// routes/customer-dashboard-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});

// Import both controllers
const mileageController = require('../controllers/mileage-controller');
const customerDashboardController = require('../controllers/customer-dashboard-controller');

// Middleware to ensure only customers can access customer dashboard routes
const isCustomerOnly = (req, res, next) => {
    if (req.user.Role !== 'Customer') {
        req.flash('error', 'Access denied. This feature is only available for customers.');
        return res.redirect('/home');
    }
    next();
};

// ============================================
// CREDIT STATEMENT ROUTES (using customerDashboardController)
// ============================================

// Route to display the credit statement dashboard page (GET)
router.get('/credit-statement', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    customerDashboardController.getCreditStatementDashboard(req, res, next);
});

// API endpoint for credit statement data (AJAX calls)
router.get('/api/credit-statement/data', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    customerDashboardController.getCreditStatementDataAPI(req, res, next);
});

// API endpoint for account balance
router.get('/api/credit-statement/balance', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    customerDashboardController.getAccountBalanceAPI(req, res, next);
});

// API endpoint for recent transactions
router.get('/api/credit-statement/transactions', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    customerDashboardController.getRecentTransactionsAPI(req, res, next);
});

// ============================================
// MILEAGE DASHBOARD ROUTES (using existing mileageController)
// ============================================

// Route to display the mileage dashboard page (GET)
router.get('/mileage-dashboard', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getMileageDashboard(req, res, next);
});

// API endpoint for dashboard data refresh (AJAX calls)
router.get('/api/mileage/data', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getMileageDataAPI(req, res, next);
});

// API endpoint for specific vehicle details
router.get('/api/mileage/vehicle/:vehicleId', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getVehicleMileageDetails(req, res, next);
});

// Future feature: Save external fuel purchases
router.post('/api/mileage/external-fuel', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.saveExternalFuelPurchase(req, res, next);
});

// Future feature: Get mileage alerts
router.get('/api/mileage/alerts', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later for maintenance alerts, poor performance warnings, etc.
    res.status(501).json({
        success: false,
        message: 'Mileage alerts feature is coming soon'
    });
});

// Future feature: Export mileage report to PDF
router.post('/export/mileage-pdf', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later using your existing PDF generation system
    res.status(501).json({
        success: false,
        message: 'PDF export feature is coming soon'
    });
});

// Future feature: Export mileage report to Excel
router.post('/export/mileage-excel', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later
    res.status(501).json({
        success: false,
        message: 'Excel export feature is coming soon'
    });
});

module.exports = router;