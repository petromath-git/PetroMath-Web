// routes/expense-master-routes.js — cashier expense master (m_expense)
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const ctrl = require('../controllers/expense-master-controller');

// SuperUser, PowerUser and Admin (m_role_permissions)
const canManage = security.hasPermission('MANAGE_EXPENSE_MASTER');

router.get('/',          [isLoginEnsured, canManage], ctrl.getExpenseMasterPage);
router.post('/api',      [isLoginEnsured, canManage], ctrl.createExpense);
router.put('/api/:id',   [isLoginEnsured, canManage], ctrl.updateExpense);
router.delete('/api/:id', [isLoginEnsured, canManage], ctrl.deleteExpense);

module.exports = router;
