const express  = require('express');
const router   = express.Router();
const login    = require('connect-ensure-login');
const security = require('../utils/app-security');
const multer   = require('multer');
const ctrl     = require('../controllers/employee-controller');

const isLoginEnsured = login.ensureLoggedIn({});

// ── Multer — employee photo uploads (memory storage → BLOB in DB) ─────────────
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB hard cap; soft limit enforced in controller
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
    }
});

// Multer error handler middleware
function handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Image must be 2 MB or smaller' });
    }
    if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/',
    [isLoginEnsured, security.hasPermission('VIEW_EMPLOYEE')],
    ctrl.getListPage
);

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/',
    [isLoginEnsured, security.hasPermission('ADD_EMPLOYEE')],
    ctrl.createEmployee
);

// ── Report page ───────────────────────────────────────────────────────────────
router.get('/report',
    [isLoginEnsured, security.hasPermission('VIEW_EMPLOYEE')],
    ctrl.getReportPage
);

// ── Report APIs ───────────────────────────────────────────────────────────────
router.get('/api/report/statement',
    [isLoginEnsured, security.hasPermission('VIEW_EMPLOYEE')],
    ctrl.getStatementData
);

router.get('/api/report/summary',
    [isLoginEnsured, security.hasPermission('VIEW_EMPLOYEE')],
    ctrl.getSummaryData
);

// ── Generate salary for a period (AJAX POST) ──────────────────────────────────
router.post('/api/generate-salary',
    [isLoginEnsured, security.hasPermission('GENERATE_EMPLOYEE_SALARY')],
    ctrl.generateSalary
);

// ── Add ledger entry (AJAX POST) ──────────────────────────────────────────────
router.post('/api/ledger',
    [isLoginEnsured, security.hasPermission('ADD_EMPLOYEE_LEDGER')],
    ctrl.addLedgerEntry
);

// ── Update employee profile (AJAX PUT) ───────────────────────────────────────
router.put('/api/:id',
    [isLoginEnsured, security.hasPermission('EDIT_EMPLOYEE')],
    ctrl.updateEmployee
);

// ── Add salary revision (AJAX POST) ──────────────────────────────────────────
router.post('/api/:id/salary',
    [isLoginEnsured, security.hasPermission('EDIT_EMPLOYEE')],
    ctrl.addSalaryRevision
);

// ── Upload photo (AJAX POST, multipart) ──────────────────────────────────────
router.post('/api/:id/photo',
    [isLoginEnsured, security.hasPermission('EDIT_EMPLOYEE')],
    (req, res, next) => photoUpload.single('photo')(req, res, err => handleMulterError(err, req, res, next)),
    ctrl.uploadPhoto
);

// ── Remove photo (AJAX DELETE) ────────────────────────────────────────────────
router.delete('/api/:id/photo',
    [isLoginEnsured, security.hasPermission('EDIT_EMPLOYEE')],
    ctrl.removePhoto
);

// ── Deactivate / Reactivate (AJAX PUT) ───────────────────────────────────────
router.put('/api/:id/deactivate',
    [isLoginEnsured, security.hasPermission('DISABLE_EMPLOYEE')],
    ctrl.deactivateEmployee
);

router.put('/api/:id/reactivate',
    [isLoginEnsured, security.hasPermission('DISABLE_EMPLOYEE')],
    ctrl.reactivateEmployee
);

// ── Delete ledger entry (AJAX DELETE) ────────────────────────────────────────
router.delete('/api/:id/ledger/:ledger_id',
    [isLoginEnsured, security.hasPermission('ADD_EMPLOYEE_LEDGER')],
    ctrl.deleteLedgerEntry
);

// ── Detail / Ledger page — must be last ──────────────────────────────────────
router.get('/:id',
    [isLoginEnsured, security.hasPermission('VIEW_EMPLOYEE')],
    ctrl.getDetailPage
);

module.exports = router;
