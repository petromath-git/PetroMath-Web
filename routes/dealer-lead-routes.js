const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const dealerLeadController = require('../controllers/dealer-lead-controller');

// GET / - Public lead capture form (no login required)
router.get('/', (req, res, next) => {
    dealerLeadController.getPublicForm(req, res, next);
});

// POST / - Submit a lead (no login required)
router.post('/', (req, res, next) => {
    dealerLeadController.submitLead(req, res, next);
});

// GET /admin - Review collected leads (SuperUser only)
router.get('/admin', [isLoginEnsured, security.isSuperUser()], (req, res, next) => {
    dealerLeadController.getAdminList(req, res, next);
});

// GET /admin/export - CSV export of collected leads (SuperUser only)
router.get('/admin/export', [isLoginEnsured, security.isSuperUser()], (req, res, next) => {
    dealerLeadController.exportCsv(req, res, next);
});

module.exports = router;
