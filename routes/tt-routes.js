// routes/tt-routes.js — Tank Truck Freight. Access by menu grant (MC, MME, SFS), both menus under
// the Truck Management head:
//   TT_FREIGHT - /tt: freight bills upload, BPCL payment advices, fleet card, statement, deleted
//   TT_MASTER  - /tt/master: oil company vendor settings + trucks
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const multer = require('multer');
const security = require('../utils/app-security');
const ctrl = require('../controllers/tt-controller');

const canBills = [isLoginEnsured, security.hasMenu('TT_FREIGHT')];
const canMaster = [isLoginEnsured, security.hasMenu('TT_MASTER')];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', canBills, ctrl.getPage);
router.get('/master', canMaster, ctrl.getMasterPage);

router.post('/api/upload/preview', canBills, upload.single('file'), ctrl.previewUpload);
router.post('/api/upload', canBills, upload.single('file'), ctrl.saveUpload);
router.get('/api/invoices/:id(\\d+)', canBills, ctrl.getInvoice);
router.post('/api/invoices/:id(\\d+)/delete', canBills, ctrl.deleteInvoice);

router.post('/api/advice/preview', canBills, upload.single('file'), ctrl.previewAdvice);
router.post('/api/advice', canBills, upload.single('file'), ctrl.saveAdvice);
router.get('/api/advice/:id(\\d+)', canBills, ctrl.getAdvice);
router.delete('/api/advice/:id(\\d+)', canBills, ctrl.deleteAdvice);

router.post('/api/card/preview', canBills, upload.single('file'), ctrl.previewCard);
router.post('/api/card', canBills, upload.single('file'), ctrl.saveCard);
router.get('/api/card/:id(\\d+)', canBills, ctrl.getCardStatement);
router.delete('/api/card/:id(\\d+)', canBills, ctrl.deleteCardStatement);

router.put('/api/vendors/:id(\\d+)', canMaster, ctrl.saveVendor);
router.put('/api/cards/:id(\\d+)', canMaster, ctrl.saveCardSettings);
router.post('/api/vehicles', canMaster, ctrl.saveVehicle);
router.put('/api/vehicles/:id(\\d+)', canMaster, ctrl.saveVehicle);
router.delete('/api/vehicles/:id(\\d+)', canMaster, ctrl.deleteVehicle);

module.exports = router;
