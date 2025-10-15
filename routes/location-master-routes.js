const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const locationController = require('../controllers/location-controller');

// ============================================================================
// PAGE ROUTES
// ============================================================================

// GET /location-master - Main location master page
// View access - allows viewing locations
router.get('/', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.getLocationMasterPage(req, res, next);
    }
);

// ============================================================================
// CRUD ROUTES
// ============================================================================

// POST /location-master - Create new location
router.post('/', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.createLocation(req, res, next);
    }
);

// PUT /location-master/:id - Update location
router.put('/:id', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.updateLocation(req, res, next);
    }
);

// PUT /location-master/:id/deactivate - Deactivate location
router.put('/:id/deactivate', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.deactivateLocation(req, res, next);
    }
);

// PUT /location-master/:id/reactivate - Reactivate location
router.put('/:id/reactivate', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.reactivateLocation(req, res, next);
    }
);

// ============================================================================
// VALIDATION ROUTES (AJAX)
// ============================================================================

// GET /location-master/validate-code - Validate location code
router.get('/validate-code', [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_MASTER')], 
    function (req, res, next) {
        locationController.validateLocationCode(req, res, next);
    }
);

module.exports = router;