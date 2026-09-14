// routes/onboarding-admin-routes.js — SuperUser only for now.
// PowerUser was granted ONBOARDING_MIGRATE at the permission-table level for a
// future relaxation, but every route here is hard-gated to SuperUser until
// that's explicitly revisited -- don't swap in hasPermission('ONBOARDING_MIGRATE')
// without discussing it first.
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const security = require('../utils/app-security');
const ctrl = require('../controllers/onboarding-controller');
const migrateCtrl = require('../controllers/onboarding-migrate-controller');

const isLoggedIn = login.ensureLoggedIn({});
const isSuperUser = security.isSuperUser();

router.get('/',              isLoggedIn, isSuperUser, ctrl.adminList);
router.post('/',             isLoggedIn, isSuperUser, ctrl.adminCreate);
router.get('/config-hints',   isLoggedIn, isSuperUser, ctrl.adminConfigHints);   // must be before /:id
router.get('/hsn-suggestions', isLoggedIn, isSuperUser, ctrl.hsnSuggestions);    // must be before /:id
router.get('/:id',              isLoggedIn, isSuperUser, ctrl.adminDetail);
router.patch('/:id/status',     isLoggedIn, isSuperUser, ctrl.adminUpdateStatus);
router.post('/:id/migrate',     isLoggedIn, isSuperUser, migrateCtrl.migrate);
router.post('/:id/apply-config', isLoggedIn, isSuperUser, ctrl.applyConfig);

module.exports = router;
