// routes/location-config-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const security = require('../utils/app-security');
const locationConfigController = require('../controllers/location-config-controller');

// ============================================================================
// PAGE ROUTES
// ============================================================================

// GET /location-config - Main location config page
// Permission: MANAGE_LOCATION_CONFIG (view configs)
router.get('/', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.getLocationConfigPage
);

// ============================================================================
// CREATE/UPDATE ROUTES
// ============================================================================

// POST /location-config/create - Create new config
// Permission: MANAGE_LOCATION_CONFIG (create configs)
router.post('/create', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.createConfig
);

// PUT /location-config/update/:configId - Update config (end-date old, create new)
// Permission: MANAGE_LOCATION_CONFIG (update configs)
router.put('/update/:configId', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.updateConfig
);

// ============================================================================
// API ROUTES (AJAX/JSON)
// ============================================================================

// GET /location-config/api/configs - Get configs with filter (for refresh)
router.get('/api/configs', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.getConfigsAPI
);

// GET /location-config/api/config/:configId - Get single config by ID
router.get('/api/config/:configId', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.getConfigByIdAPI
);

// POST /location-config/validate-duplicate - Validate duplicate setting
router.post('/validate-duplicate', 
    [isLoginEnsured, security.hasPermission('MANAGE_LOCATION_CONFIG')], 
    locationConfigController.validateDuplicate
);

module.exports = router;