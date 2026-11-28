const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const multer = require('multer');
const purchasesController = require('../controllers/purchases-controller');

const isLoginEnsured = login.ensureLoggedIn({});

router.get('/',                  isLoginEnsured, (req, res, next) => purchasesController.getList(req, res, next));
router.get('/fuel-invoice/new',  isLoginEnsured, (req, res, next) => purchasesController.getNewFuelInvoice(req, res, next));
router.get('/fuel-invoice/:id/pdf', isLoginEnsured, (req, res, next) => purchasesController.getFuelInvoicePdf(req, res, next));
router.get('/fuel-invoice/:id',     isLoginEnsured, (req, res, next) => purchasesController.getFuelInvoice(req, res, next));
router.post('/fuel-invoice/save',      isLoginEnsured, (req, res, next) => purchasesController.saveFuelInvoice(req, res, next));
router.post('/fuel-invoice/:id/delete', isLoginEnsured, (req, res, next) => purchasesController.deleteFuelInvoice(req, res, next));

// CNG invoices (tkt #481): many PDFs at once, one per request, only at bunks with a CNG product
const cngUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || ''))
});
router.get('/cng-invoices/upload', isLoginEnsured, (req, res, next) => purchasesController.getCngUpload(req, res, next));
router.post('/cng-invoices/import', isLoginEnsured, cngUpload.single('invoicePdf'),
    (req, res, next) => purchasesController.importCngInvoice(req, res, next));

module.exports = router;
