// routes/transaction-corrections-routes.js
const express = require('express');
const router = express.Router();
const transactionCorrectionsController = require('../controllers/transaction-corrections-controller');
const appSecurity = require('../utils/app-security');

// Render the Credit Transaction Corrections page
router.get('/', transactionCorrectionsController.renderPage);

// Search credit transactions
router.get('/search', transactionCorrectionsController.searchTransactions);

// Get customers for dropdown
router.get('/customers', transactionCorrectionsController.getCustomers);

// Update odometer reading for a credit transaction
router.put('/credits/:tcreditId/odometer', 
    appSecurity.hasPermission('EDIT_ODOMETER_POST_CLOSING'),
    transactionCorrectionsController.updateOdometerReading
);

// Update credit party for a credit transaction
router.put('/credits/:tcreditId/credit-party', 
    appSecurity.hasPermission('EDIT_CREDIT_PARTY_POST_CLOSING'),
    transactionCorrectionsController.updateCreditParty
);

module.exports = router;