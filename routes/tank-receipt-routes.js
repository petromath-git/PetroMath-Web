const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const tankReceiptController = require('../controllers/tank-receipt-controller');

const isLoginEnsured = login.ensureLoggedIn({});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads', 'tank-invoices');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are accepted'));
        }
    }
});

// Verify uploaded file starts with PDF magic bytes (%PDF)
function validatePdfMagicBytes(req, res, next) {
    if (!req.file) return next();
    const fd = fs.openSync(req.file.path, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii') !== '%PDF') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: 'Uploaded file is not a valid PDF.' });
    }
    next();
}

router.post('/parse-invoice',
    isLoginEnsured,
    upload.single('invoicePdf'),
    validatePdfMagicBytes,
    (req, res, next) => tankReceiptController.parseInvoicePdf(req, res, next)
);

router.post('/save-invoice',
    isLoginEnsured,
    (req, res, next) => tankReceiptController.saveInvoiceWithProducts(req, res, next)
);

router.get('/invoice-preview',
    isLoginEnsured,
    (req, res, next) => tankReceiptController.invoicePreview(req, res, next)
);

router.get('/check-invoice-number',
    isLoginEnsured,
    (req, res, next) => tankReceiptController.checkInvoiceNumber(req, res, next)
);

module.exports = router;
