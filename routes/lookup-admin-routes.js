const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const security = require('../utils/app-security');
const controller = require('../controllers/lookup-admin-controller');

const isLoginEnsured = login.ensureLoggedIn({});
const isAdmin = [isLoginEnsured, security.isAdmin()];
const isSuperUser = [isLoginEnsured, security.isSuperUser()];

// Page
router.get('/', isAdmin, controller.getPage);

// Values (AJAX)
router.get('/values', isAdmin, controller.getValues);

// Add value — admin adds location-specific, superuser can also add global
router.post('/values', isAdmin, controller.addValue);

// Deactivate / reactivate — superuser any row, admin only their location's rows
router.put('/values/:id/deactivate', isAdmin, controller.deactivateValue);
router.put('/values/:id/reactivate', isAdmin, controller.reactivateValue);

module.exports = router;
