// routes/bank-statement-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const appSecurity = require('../utils/app-security');
const bankStatementController = require('../controllers/bank-statement-controller');

// GET route - Render the Bank Statement page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        bankStatementController.getStatementData(req, res, next);
    }
);

// GET route - API endpoint to get bank accounts for location
router.get('/banks', 
    isLoginEnsured,
    (req, res, next) => {
        bankStatementController.getBanksForLocation(req, res, next);
    }
);

// GET route - API endpoint to get ledgers for selected bank
router.get('/ledgers', 
    isLoginEnsured,
    (req, res, next) => {
        bankStatementController.getLedgersForBank(req, res, next);
    }
);

// GET route - API endpoint to get accounting type for transaction type
router.get('/account-type', 
    isLoginEnsured,
    (req, res, next) => {
        bankStatementController.getAccountingType(req, res, next);
    }
);

// POST route - Save bank transactions
router.post('/', 
    isLoginEnsured,
    appSecurity.hasPermission('EDIT_BANK_STATEMENT'), 
    (req, res, next) => {
        bankStatementController.saveTransactionData(req, res, next);
    }
);

// DELETE route - Delete bank transaction
router.delete('/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('DELETE_BANK_STATEMENT'), 
    (req, res, next) => {
        bankStatementController.deleteTransaction(req, res, next);
    }
);

module.exports = router;