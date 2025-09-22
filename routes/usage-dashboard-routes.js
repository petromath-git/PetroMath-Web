// routes/usage-dashboard-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const usageDashboardController = require('../controllers/usage-dashboard-controller');

// Main usage dashboard page
router.get('/', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getUsageDashboard(req, res, next);
});

// API endpoints for dashboard data (AJAX calls)
router.get('/api/overview', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getUsageOverview(req, res, next);
});

router.get('/api/location-stats', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getLocationStats(req, res, next);
});

router.get('/api/feature-usage', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getFeatureUsage(req, res, next);
});

router.get('/api/time-patterns', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getTimePatterns(req, res, next);
});

router.get('/api/user-activity', [isLoginEnsured, security.hasPermission('VIEW_USAGE_DASHBOARD')], function (req, res, next) {
    usageDashboardController.getUserActivity(req, res, next);
});

// Export raw data for analysis (requires higher permission)
router.get('/export/csv', [isLoginEnsured, security.hasPermission('EXPORT_USAGE_DATA')], function (req, res, next) {
    usageDashboardController.exportUsageData(req, res, next);
});

module.exports = router;