// routes/oil-company-statement-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const appSecurity = require('../utils/app-security');
const oilCompanyStatementController = require('../controllers/oil-company-statement-controller');

// GET route - Render the Oil Company Statement page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        oilCompanyStatementController.getStatementData(req, res, next);
    }
);

// GET route - API endpoint to get oil company banks
router.get('/banks', 
    isLoginEnsured,
    (req, res, next) => {
        oilCompanyStatementController.getBanksForLocation(req, res, next);
    }
);

// GET route - API endpoint to get ledgers for selected bank
router.get('/ledgers', 
    isLoginEnsured,
    (req, res, next) => {
        oilCompanyStatementController.getLedgersForBank(req, res, next);
    }
);

// POST route - Save oil company transactions
router.post('/', 
    isLoginEnsured,
    appSecurity.hasPermission('EDIT_OIL_COMPANY_STATEMENT'), 
    (req, res, next) => {
        oilCompanyStatementController.saveTransactionData(req, res, next);
    }
);

// DELETE route - Delete oil company transaction
router.delete('/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('DELETE_OIL_COMPANY_STATEMENT'), 
    (req, res, next) => {
        oilCompanyStatementController.deleteTransaction(req, res, next);
    }
);

module.exports = router;