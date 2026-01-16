const express = require('express');
const router = express.Router();
const GstController = require('../controllers/gst-controller');
const login = require('connect-ensure-login');

// Middleware to ensure login for all GST routes
const isLoginEnsured = login.ensureLoggedIn('/login');

// Dashboard - /gst
router.get('/', isLoginEnsured, GstController.getDashboard);

// Configuration - /gst/config
router.get('/config', isLoginEnsured, GstController.getConfigPage);
router.post('/config', isLoginEnsured, GstController.saveConfig);

// Generate Returns - /gst/generate/:returnType
router.get('/generate/:returnType', isLoginEnsured, GstController.getGenerateReturnPage);
router.post('/preview', isLoginEnsured, GstController.previewReturn);
router.post('/download', isLoginEnsured, GstController.downloadReturn);

// History - /gst/history, /gst/return/:id
router.get('/history', isLoginEnsured, GstController.getFilingHistory);
router.get('/return/:returnDataId', isLoginEnsured, GstController.getReturnDetails);

module.exports = router;