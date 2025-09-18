// routes/bills-routes.js
const express = require('express');
const router = express.Router();
const billController = require('../controllers/bill-controller');
const login = require('connect-ensure-login');
const security = require('../utils/app-security');

// Middleware to ensure login for all bill routes
const isLoginEnsured = login.ensureLoggedIn('/login');



// Bills list page
router.get('/', isLoginEnsured, billController.getBills);

// Create new bill form
router.get('/new', isLoginEnsured, billController.getNewBill);

// Create new bill (POST)
router.post('/', isLoginEnsured, billController.createBill);

// Edit bill form
router.get('/edit/:billId', isLoginEnsured, billController.editBill);

// Update bill 
router.post('/:billId/update', isLoginEnsured, billController.updateBill);

router.post('/delete/:billId', isLoginEnsured, billController.deleteBill);

// Cancel bill (admin only)
router.put('/:billId/cancel', [isLoginEnsured, security.isAdmin()], billController.cancelBill);

// Get bill details
router.get('/:billId', isLoginEnsured, billController.getBillDetails);

// Get bill details (alternate route)
router.get('/:billId/details', isLoginEnsured, billController.getBillDetails);

// Print bill
router.get('/:id/print', isLoginEnsured, billController.printBill);

// Print bill as PDF
router.get('/:id/print/pdf', isLoginEnsured, billController.printBillPDF);

module.exports = router;