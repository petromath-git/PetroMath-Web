// routes/bank-master-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const bankController = require('../controllers/bank-controller');

// Display bank master page
router.get('/', 
    [isLoginEnsured, security.hasPermission('VIEW_BANK_MASTER')], 
    bankController.getBankMasterPage
);

// Display disabled banks page
router.get('/enable', 
    [isLoginEnsured, security.hasPermission('VIEW_BANK_MASTER')], 
    bankController.getDisabledBanksPage
);

// Create new bank
router.post('/', 
    [isLoginEnsured, security.hasPermission('ADD_BANK_MASTER')], 
    bankController.createBank
);

// Update bank
router.put('/api/:id', 
    [isLoginEnsured, security.hasPermission('EDIT_BANK_MASTER')], 
    bankController.updateBank
);

// Disable bank
router.put('/disable/:id', 
    [isLoginEnsured, security.hasPermission('DISABLE_BANK_MASTER')], 
    bankController.disableBank
);

// Enable bank
router.put('/enable/:id', 
    [isLoginEnsured, security.hasPermission('DISABLE_BANK_MASTER')], 
    bankController.enableBank
);

module.exports = router;