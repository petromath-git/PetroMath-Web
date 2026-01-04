const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const bankReconController = require('../controllers/bank-reconciliation-controller');

// GET route - Render the Bank Reconciliation page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.getBankReconPage(req, res, next);
    }
);

// POST route - Get reconciliation report data
router.post('/',
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.getBankReconReport(req, res, next);
    }
);

module.exports = router;