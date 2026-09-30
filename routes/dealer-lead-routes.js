const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const dealerLeadController = require('../controllers/dealer-lead-controller');

// Lead list, follow-ups and export need MANAGE_DEALER_LEADS (SuperUser + PowerUser)
const canManage = [isLoginEnsured, security.hasPermission('MANAGE_DEALER_LEADS')];

// GET / - Public lead capture form (no login required)
router.get('/', (req, res, next) => {
    dealerLeadController.getPublicForm(req, res, next);
});

// POST / - Submit a lead (no login required)
router.post('/', (req, res, next) => {
    dealerLeadController.submitLead(req, res, next);
});

// GET /admin - Lead list with filters and follow-up summary
router.get('/admin', canManage, (req, res, next) => {
    dealerLeadController.getAdminList(req, res, next);
});

// GET /admin/export - CSV export of the filtered leads
router.get('/admin/export', canManage, (req, res, next) => {
    dealerLeadController.exportCsv(req, res, next);
});

// GET /admin/:leadId - Lead detail, activity timeline, log form
router.get('/admin/:leadId(\\d+)', canManage, (req, res, next) => {
    dealerLeadController.getLeadDetail(req, res, next);
});

// POST /admin/:leadId/activity - Log a call / visit / note
router.post('/admin/:leadId(\\d+)/activity', canManage, (req, res, next) => {
    dealerLeadController.logActivity(req, res, next);
});

// POST /admin/:leadId - Correct the lead's details
router.post('/admin/:leadId(\\d+)', canManage, (req, res, next) => {
    dealerLeadController.updateLead(req, res, next);
});

module.exports = router;
