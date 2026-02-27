const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const dsmEntryController = require('../controllers/dsm-entry-controller');

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

// GET /dsm-entry/vehicles/:creditlistId - Load vehicles for selected customer
router.get('/vehicles/:creditlistId',
    [isLoginEnsured, security.hasPermission('DSM_CREDIT_ENTRY')],
    (req, res, next) => {
        dsmEntryController.getVehicles(req, res, next);
    }
);

module.exports = router;