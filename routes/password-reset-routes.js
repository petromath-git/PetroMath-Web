const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const passwordResetController = require('../controllers/password-reset-controller');

// Route to show the password reset page
router.get('/', [isLoginEnsured], passwordResetController.getPasswordResetPage);

// Route to handle the password reset logic
router.post('/reset', [isLoginEnsured], passwordResetController.resetPassword);

// Route to handle password change logic for the logged-in user
router.post('/change-password', [isLoginEnsured], passwordResetController.changePassword);

module.exports = router;
