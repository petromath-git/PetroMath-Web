// routes/credit-receipts-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const receiptController = require('../controllers/credit-receipt-controller');

// GET - Display credit receipts page
router.get('/', [isLoginEnsured, security.isAdmin()], receiptController.getReceipts);

// POST - Create new credit receipt
router.post('/', [isLoginEnsured, security.isAdmin()], receiptController.saveReceipts);

// PUT - Update existing credit receipt
router.put('/receipt/:id', [isLoginEnsured, security.isAdmin()], receiptController.updateReceipts);

// DELETE - Delete credit receipt
router.delete('/delete-receipt', [isLoginEnsured, security.isAdmin()], receiptController.deleteReceipts);

module.exports = router;