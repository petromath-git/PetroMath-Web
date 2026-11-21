// routes/oil-invoice-routes.js — IOCL Invoices (tkt #484). Access by menu grant OIL_CO_INVOICES
// (Transactions > IOCL Invoices; Admin, PowerUser, SuperUser).
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const security = require('../utils/app-security');
const ctrl = require('../controllers/oil-invoice-controller');
const { MAX_FILES } = require('../services/oil-invoice-service');

const canUse = [isLoginEnsured, security.hasMenu('OIL_CO_INVOICES')];

// PDFs only, up to MAX_FILES of 5 MB each; errors become req.uploadError (shown to the user).
const multerFiles = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: MAX_FILES },
    fileFilter: (req, file, cb) => cb(null, /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname)),
}).array('files', MAX_FILES);
const upload = (req, res, next) => multerFiles(req, res, (err) => {
    if (err) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Each PDF must be 5 MB or smaller.'
            : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') ? `Upload at most ${MAX_FILES} files at a time.`
            : err.message;
        req.files = [];
    }
    next();
});

router.get('/', canUse, ctrl.getPage);
router.get('/:id(\\d+)/pdf', canUse, ctrl.getPdf);
router.post('/api/preview', canUse, upload, ctrl.preview);
router.post('/api/save', canUse, upload, ctrl.save);
router.get('/api/invoices/:id(\\d+)', canUse, ctrl.getInvoice);
router.get('/api/invoices/:id(\\d+)/candidates', canUse, ctrl.getCandidates);
router.post('/api/invoices/:id(\\d+)/link', canUse, ctrl.link);
router.post('/api/invoices/:id(\\d+)/delete', canUse, ctrl.deleteInvoice);
// Email import (forwarding Gmail mailboxes)
router.post('/api/mailboxes', canUse, ctrl.createMailbox);
router.post('/api/mailboxes/:id(\\d+)', canUse, ctrl.updateMailbox);
router.post('/api/mailboxes/:id(\\d+)/delete', canUse, ctrl.deleteMailbox);
router.post('/api/mailboxes/:id(\\d+)/run', canUse, ctrl.runMailbox);
router.post('/api/mailboxes/:id(\\d+)/script', canUse, ctrl.newScript);

// The Google script in a forwarding Gmail posts here: no login, its key (X-PetroMath-Key) says which mailbox.
const inboundLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ success: false, error: 'Too many requests; try again later.' }),
});
router.post('/inbound', inboundLimiter, ctrl.inbound);

module.exports = router;
