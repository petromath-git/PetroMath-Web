// routes/rental-routes.js — rental invoices (/rental). Access by menu grant
// RENTAL_INVOICES (granted to MC only in Menu Management).
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const ctrl = require('../controllers/rental-controller');

const canUse = [isLoginEnsured, security.hasMenu('RENTAL_INVOICES')];

router.get('/', canUse, ctrl.getPage);
router.get('/invoice/:id(\\d+)/pdf', canUse, ctrl.invoicePdf);

router.put('/api/settings', canUse, ctrl.saveSettings);

router.post('/api/tenants', canUse, ctrl.createTenant);
router.put('/api/tenants/:id(\\d+)', canUse, ctrl.updateTenant);
router.delete('/api/tenants/:id(\\d+)', canUse, ctrl.deleteTenant);

router.post('/api/generate', canUse, ctrl.generateDrafts);
router.post('/api/finalize', canUse, ctrl.finalize);
router.put('/api/invoices/:id(\\d+)', canUse, ctrl.updateDraft);
router.delete('/api/invoices/:id(\\d+)', canUse, ctrl.deleteDraft);
router.post('/api/invoices/:id(\\d+)/cancel', canUse, ctrl.cancelInvoice);

module.exports = router;
