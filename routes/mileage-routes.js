// routes/mileage-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const mileageController = require('../controllers/mileage-controller');

// Middleware to ensure only customers can access mileage routes
const isCustomerOnly = (req, res, next) => {
    if (req.user.Role !== 'Customer') {
        req.flash('error', 'Access denied. This feature is only available for customers.');
        return res.redirect('/home');
    }
    next();
};

// Route to display the mileage dashboard page (GET)
router.get('/dashboard', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getMileageDashboard(req, res, next);
});

// API endpoint for dashboard data refresh (AJAX calls)
router.get('/api/data', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getMileageDataAPI(req, res, next);
});

// API endpoint for specific vehicle details
router.get('/api/vehicle/:vehicleId', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.getVehicleMileageDetails(req, res, next);
});

// Future feature: Save external fuel purchases
router.post('/api/external-fuel', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    mileageController.saveExternalFuelPurchase(req, res, next);
});

// Future feature: Get mileage alerts
router.get('/api/alerts', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later for maintenance alerts, poor performance warnings, etc.
    res.status(501).json({
        success: false,
        message: 'Mileage alerts feature is coming soon'
    });
});

// Future feature: Export mileage report to PDF
router.post('/export/pdf', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later using your existing PDF generation system
    res.status(501).json({
        success: false,
        message: 'PDF export feature is coming soon'
    });
});

// Future feature: Export mileage report to Excel
router.post('/export/excel', [isLoginEnsured, isCustomerOnly], function (req, res, next) {
    // This will be implemented later
    res.status(501).json({
        success: false,
        message: 'Excel export feature is coming soon'
    });
});

module.exports = router;