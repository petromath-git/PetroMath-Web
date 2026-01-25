// routes/transaction-upload-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const multer = require('multer');
const transactionUploadController = require('../controllers/transaction-upload-controller');

// Configure multer for file uploads (memory storage)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
        }
    }
});

// GET route - Render the Transaction Upload page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        transactionUploadController.getUploadPage(req, res, next);
    }
);

// POST route - Upload and preview transactions
router.post('/preview',
    isLoginEnsured,
    upload.single('transactionFile'),
    (req, res, next) => {
        transactionUploadController.previewTransactions(req, res, next);
    }
);


// GET route - Get ledgers with suggestion (ADD THIS)
router.get('/ledgers-suggest',
    isLoginEnsured,
    (req, res, next) => {
        transactionUploadController.getLedgersWithSuggestion(req, res, next);
    }
);


// POST route - Save transactions to bank_transactions table
router.post('/save',
    isLoginEnsured,
    (req, res, next) => {
        transactionUploadController.saveTransactions(req, res, next);
    }
);

// GET route - Get ledgers for bank (for dropdown)
router.get('/ledgers',
    isLoginEnsured,
    (req, res, next) => {
        transactionUploadController.getLedgersForBank(req, res, next);
    }
);

module.exports = router;