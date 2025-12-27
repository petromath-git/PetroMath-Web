// routes/digital-sales-corrections-routes.js
const express = require('express');
const router = express.Router();
const digitalSalesCorrectionsController = require('../controllers/digital-sales-corrections-controller');
const appSecurity = require('../utils/app-security');

// Render the Digital Sales Corrections page
router.get('/', digitalSalesCorrectionsController.renderPage);

// Search digital sales transactions
router.get('/search', digitalSalesCorrectionsController.searchTransactions);

// Get digital vendors for dropdown
router.get('/vendors', digitalSalesCorrectionsController.getVendors);

// Update vendor for a digital sales transaction
router.put('/digital-sales/:digitalSalesId/vendor', 
    appSecurity.hasPermission('EDIT_DIGITAL_VENDOR_POST_CLOSING'),
    digitalSalesCorrectionsController.updateVendor
);

module.exports = router;






