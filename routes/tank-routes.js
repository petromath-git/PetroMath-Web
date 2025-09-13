const express = require('express');
const router = express.Router();
const tankController = require('../controllers/tank-controller');
const appSecurity = require('../utils/app-security');

// Tank Master - Main page (accessible to all authenticated users for viewing)
router.get('/', tankController.getTankMaster);

// Tank CRUD operations - restricted to users with MANAGE_TANK_MASTER permission
router.post('/', 
    appSecurity.hasPermission('MANAGE_TANK_MASTER'),
    tankController.createTank
);

router.put('/:id', 
    appSecurity.hasPermission('MANAGE_TANK_MASTER'),
    tankController.updateTank
);

router.put('/:id/deactivate', 
    appSecurity.hasPermission('MANAGE_TANK_MASTER'),
    tankController.deactivateTank
);

// Tank validation endpoint - for checking duplicate codes before saving
router.get('/validate', 
    appSecurity.hasPermission('MANAGE_TANK_MASTER'),
    tankController.validateTank
);

module.exports = router;