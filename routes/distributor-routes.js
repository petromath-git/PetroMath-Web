// routes/distributor-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const controller = require('../controllers/distributor-controller');

// Distributor payables is platform-billing-adjacent internal accounting —
// gated by the same MANAGE_PLATFORM_BILLING permission (SuperUser only).
const guard = [isLoginEnsured, security.hasPermission('MANAGE_PLATFORM_BILLING')];

router.get('/', guard, controller.getList);
router.post('/', guard, controller.createDistributor);
router.post('/assignments', guard, controller.createAssignment);
router.get('/ledger', guard, controller.getLedger);
router.get('/:id/pending-commissions', guard, controller.getPendingCommissions);
router.post('/payouts', guard, controller.recordPayout);

module.exports = router;
