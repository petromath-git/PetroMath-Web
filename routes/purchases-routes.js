const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const purchasesController = require('../controllers/purchases-controller');

const isLoginEnsured = login.ensureLoggedIn({});

router.get('/',                  isLoginEnsured, (req, res, next) => purchasesController.getList(req, res, next));
router.get('/fuel-invoice/new',  isLoginEnsured, (req, res, next) => purchasesController.getNewFuelInvoice(req, res, next));
router.get('/fuel-invoice/:id',  isLoginEnsured, (req, res, next) => purchasesController.getFuelInvoice(req, res, next));
router.post('/fuel-invoice/save',isLoginEnsured, (req, res, next) => purchasesController.saveFuelInvoice(req, res, next));

module.exports = router;
