// routes/deadline-routes.js — Deadlines & Renewals (/deadline) and the bank holiday calendar
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const ctrl = require('../controllers/deadline-controller');

// Manager, Admin, PowerUser, SuperUser (same as the old Deadline Manager)
const canManage = [isLoginEnsured, security.isAdmin()];

router.get('/',                      canManage, ctrl.getPage);
router.post('/api',                  canManage, ctrl.createItem);
router.put('/api/:id',               canManage, ctrl.updateItem);
router.delete('/api/:id',            canManage, ctrl.deleteItem);
router.post('/api/:id/renew',        canManage, ctrl.renewItem);
router.get('/api/:id/history',       canManage, ctrl.getHistory);
router.post('/holidays/api',         canManage, ctrl.createHoliday);
router.delete('/holidays/api/:id',   canManage, ctrl.deleteHoliday);

module.exports = router;
