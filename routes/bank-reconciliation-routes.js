const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const multer = require('multer');
const bankReconController = require('../controllers/bank-reconciliation-controller');

// Configure multer for file uploads (memory storage)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
        }
    }
});

// GET route - Render the Bank Reconciliation page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.getBankReconPage(req, res, next);
    }
);

// POST route - Get reconciliation report data
router.post('/',
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.getBankReconReport(req, res, next);
    }
);

// GET route - Impact analysis for transaction deletion
router.get('/impact/:txnId', 
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.getImpactAnalysis(req, res, next);
    }
);

// DELETE route - Delete transaction with cascade
router.delete('/delete/:txnId',
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.deleteTransaction(req, res, next);
    }
);

// POST route - Upload bank statement file
router.post('/upload',
    isLoginEnsured,
    upload.single('bankStatement'),
    (req, res, next) => {
        bankReconController.uploadBankStatement(req, res, next);
    }
);

// POST route - Save uploaded bank statement transactions
router.post('/save-statement',
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.saveBankStatement(req, res, next);
    }
);

router.post('/add-entry',
    isLoginEnsured,
    (req, res, next) => {
        bankReconController.addEntryToPetromath(req, res, next);
    }
);

module.exports = router;