// routes/rental-routes.js — rental invoices. Access by menu grant (both granted to MC only):
//   RENTAL_INVOICES (Transactions) - /rental: invoices + tenant statement
//   RENTAL_MASTER   (Masters)      - /rental/master: tenants + settings
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const ctrl = require('../controllers/rental-controller');

const canInvoice = [isLoginEnsured, security.hasMenu('RENTAL_INVOICES')];
const canMaster = [isLoginEnsured, security.hasMenu('RENTAL_MASTER')];

router.get('/', canInvoice, ctrl.getPage);
router.get('/invoice/:id(\\d+)/pdf', canInvoice, ctrl.invoicePdf);
router.get('/master', canMaster, ctrl.getMasterPage);

router.put('/api/settings', canMaster, ctrl.saveSettings);

router.post('/api/tenants', canMaster, ctrl.createTenant);
router.put('/api/tenants/:id(\\d+)', canMaster, ctrl.updateTenant);
router.delete('/api/tenants/:id(\\d+)', canMaster, ctrl.deleteTenant);

router.post('/api/generate', canInvoice, ctrl.generateDrafts);
router.post('/api/finalize', canInvoice, ctrl.finalize);
router.put('/api/invoices/:id(\\d+)', canInvoice, ctrl.updateDraft);
router.delete('/api/invoices/:id(\\d+)', canInvoice, ctrl.deleteDraft);
router.post('/api/invoices/:id(\\d+)/cancel', canInvoice, ctrl.cancelInvoice);

module.exports = router;
