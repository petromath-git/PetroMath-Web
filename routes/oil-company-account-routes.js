// routes/oil-company-account-routes.js
// Oil Company Accounts master + IOCL e-Mitra portal pull.
// Add / edit / disable of the accounts themselves reuse the /bank-master endpoints.
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const controller = require('../controllers/oil-company-account-controller');

router.get('/',
    [isLoginEnsured, security.hasPermission('VIEW_BANK_MASTER')],
    controller.getOilCompanyAccountsPage
);

router.get('/enable',
    [isLoginEnsured, security.hasPermission('VIEW_BANK_MASTER')],
    controller.getDisabledAccountsPage
);

// Portal login (Admin / PowerUser / SuperUser — checked in the controller)
router.put('/api/:id/portal-login',
    [isLoginEnsured, security.hasPermission('EDIT_BANK_MASTER')],
    controller.savePortalLogin
);

router.delete('/api/:id/portal-login',
    [isLoginEnsured, security.hasPermission('EDIT_BANK_MASTER')],
    controller.deletePortalLogin
);

// Used by Upload Transactions (same access as that page)
router.get('/api/pullable',
    isLoginEnsured,
    controller.getPullableAccounts
);

router.post('/api/:id/pull',
    isLoginEnsured,
    controller.pullStatement
);

module.exports = router;
