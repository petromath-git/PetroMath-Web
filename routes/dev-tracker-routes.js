// routes/dev-tracker-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const devTrackerController = require('../controllers/dev-tracker-controller');

// ============================================================================
// PAGE ROUTES (Pug Templates)
// ============================================================================

// Main dev tracker dashboard page
router.get('/', isLoginEnsured, function (req, res, next) {
    devTrackerController.getDevTrackerPage(req, res, next);
});

// New tracker form page
router.get('/new', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.getNewTrackerPage(req, res, next);
});

// View specific tracker details with tasks
router.get('/:id', isLoginEnsured, function (req, res, next) {
    devTrackerController.getTrackerDetailsPage(req, res, next);
});

// Edit tracker form page
router.get('/:id/edit', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.getEditTrackerPage(req, res, next);
});

// ============================================================================
// TRACKER CRUD ROUTES (Hybrid: Form/AJAX)
// ============================================================================

// Create new tracker
router.post('/', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.createTracker(req, res, next);
});

// Update tracker
router.put('/:id', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.updateTracker(req, res, next);
});

// Soft delete tracker
router.delete('/:id', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.deleteTracker(req, res, next);
});

// ============================================================================
// TASK MANAGEMENT ROUTES (Hybrid: Form/AJAX)
// ============================================================================

// Create new task for a tracker
router.post('/:id/tasks', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.createTask(req, res, next);
});

// Update task
router.put('/tasks/:taskId', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.updateTask(req, res, next);
});

// Soft delete task
router.delete('/tasks/:taskId', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.deleteTask(req, res, next);
});

// ============================================================================
// API ROUTES (Always JSON responses)
// ============================================================================

// Get trackers list with filters (JSON)
router.get('/api/trackers', isLoginEnsured, function (req, res, next) {
    devTrackerController.getTrackersAPI(req, res, next);
});

// Get specific tracker details (JSON)
router.get('/api/trackers/:id', isLoginEnsured, function (req, res, next) {
    devTrackerController.getTrackerAPI(req, res, next);
});

// Search trackers (JSON)
router.post('/api/search', isLoginEnsured, function (req, res, next) {
    devTrackerController.searchTrackersAPI(req, res, next);
});

// Update task progress percentage (JSON)
router.put('/api/tasks/:taskId/progress', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    devTrackerController.updateTaskProgressAPI(req, res, next);
});

// ============================================================================
// FUTURE ENHANCEMENT ROUTES (Placeholder)
// ============================================================================

// Export trackers to Excel (future)
router.post('/export/excel', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Excel export feature is coming soon'
    });
});

// Export tracker details to PDF (future)
router.post('/:id/export/pdf', isLoginEnsured, function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'PDF export feature is coming soon'
    });
});

// File attachment upload (future - when S3 integration is ready)
router.post('/:id/attachments', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'File attachment feature is coming soon'
    });
});

// Task attachment upload (future)
router.post('/tasks/:taskId/attachments', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Task attachment feature is coming soon'
    });
});

// Get tracker statistics/analytics (future dashboard enhancement)
router.get('/api/analytics', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Analytics feature is coming soon'
    });
});

// Bulk operations (future)
router.post('/api/bulk-update', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    res.status(501).json({
        success: false,
        message: 'Bulk operations feature is coming soon'
    });
});

module.exports = router;