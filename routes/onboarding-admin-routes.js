// routes/onboarding-admin-routes.js — requires login
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const ctrl = require('../controllers/onboarding-controller');
const migrateCtrl = require('../controllers/onboarding-migrate-controller');

const isLoggedIn = login.ensureLoggedIn({});

router.get('/',              isLoggedIn, ctrl.adminList);
router.post('/',             isLoggedIn, ctrl.adminCreate);
router.get('/config-hints',   isLoggedIn, ctrl.adminConfigHints);   // must be before /:id
router.get('/hsn-suggestions', isLoggedIn, ctrl.hsnSuggestions);    // must be before /:id
router.get('/:id',              isLoggedIn, ctrl.adminDetail);
router.patch('/:id/status',     isLoggedIn, ctrl.adminUpdateStatus);
router.post('/:id/migrate',     isLoggedIn, migrateCtrl.migrate);
router.post('/:id/apply-config', isLoggedIn, ctrl.applyConfig);

module.exports = router;
