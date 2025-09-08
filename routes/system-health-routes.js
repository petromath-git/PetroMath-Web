// routes/system-health-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const systemHealthController = require('../controllers/system-health-controller');

// Middleware to ensure only admins/superusers can access system health
const isAdminOrSuperUser = (req, res, next) => {
    if (req.user.Role !== 'Admin' && req.user.Role !== 'SuperUser') {
        req.flash('error', 'Access denied. System health monitoring is only available for administrators.');
        return res.redirect('/home');
    }
    next();
};

// Route to display the system health dashboard page (GET)
router.get('/dashboard', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getSystemHealthDashboard(req, res, next);
});

// API endpoint for real-time system metrics (AJAX calls)
router.get('/api/metrics', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getSystemMetrics(req, res, next);
});

// API endpoint for server performance data
router.get('/api/server-performance', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getServerPerformance(req, res, next);
});

// API endpoint for database health metrics
router.get('/api/database-health', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getDatabaseHealth(req, res, next);
});

// API endpoint for network performance tests
router.get('/api/network-performance', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getNetworkPerformance(req, res, next);
});

// API endpoint for storage utilization
router.get('/api/storage-utilization', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getStorageUtilization(req, res, next);
});

// API endpoint for system services status
router.get('/api/services-status', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getServicesStatus(req, res, next);
});

// API endpoint for historical metrics (for trending)
router.get('/api/metrics/history', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    systemHealthController.getMetricsHistory(req, res, next);
});

// Future feature: System alerts configuration
router.get('/api/alerts', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'System alerts configuration feature is coming soon'
    });
});

// Future feature: Export system health report
router.post('/export/pdf', [isLoginEnsured, isAdminOrSuperUser], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'PDF export feature is coming soon'
    });
});

// Future feature: System maintenance mode toggle
router.post('/api/maintenance-mode', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Maintenance mode toggle feature is coming soon'
    });
});

module.exports = router;