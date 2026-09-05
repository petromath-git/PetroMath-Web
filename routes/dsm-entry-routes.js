const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const multer = require('multer');
const dsmEntryController = require('../controllers/dsm-entry-controller');

// Multer — bill photo uploads (memory storage → BLOB in t_document_store), same
// pattern as employee photo uploads in routes/employee-routes.js
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },   // 10 MB hard cap; soft limit enforced in controller via DOC_MAX_UPLOAD_MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
    }
});

function handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Photo must be 10 MB or smaller' });
    }
    if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
}

// GET /dsm-entry - Mobile credit entry page
router.get('/',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.getPage(req, res, next);
    }
);

// POST /dsm-entry - Save a new credit entry
router.post('/',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.saveEntry(req, res, next);
    }
);

// DELETE /dsm-entry/:tcreditId - Delete an entry (cashier's own closing only)
router.delete('/:tcreditId',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.deleteEntry(req, res, next);
    }
);

// GET /dsm-entry/all-vehicles - Load all vehicles for location (vehicle-first mode)
router.get('/all-vehicles',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.getAllVehicles(req, res, next);
    }
);

// GET /dsm-entry/vehicles/:creditlistId - Load vehicles for selected customer
router.get('/vehicles/:creditlistId',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.getVehicles(req, res, next);
    }
);

// POST /dsm-entry/quick-add-vehicle - Quick-add a vehicle for a customer.
// Gated by ALLOW_DSM_QUICK_ADD_VEHICLE location config (checked in the controller),
// not by the QUICK_ADD_VEHICLE permission -- DSM_CREDIT_ENTRY is enough here.
router.post('/quick-add-vehicle',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.quickAddVehicle(req, res, next);
    }
);

// POST /dsm-entry/:tcreditId/photo - Attach or swap the printed-bill photo for an entry
router.post('/:tcreditId/photo',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY'), photoUpload.single('photo'), handleMulterError],
    (req, res, next) => {
        dsmEntryController.uploadPhoto(req, res, next);
    }
);

// DELETE /dsm-entry/:tcreditId/photo/:docId - Unlink a bill photo (soft-delete)
router.delete('/:tcreditId/photo/:docId',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.deletePhoto(req, res, next);
    }
);

module.exports = router;