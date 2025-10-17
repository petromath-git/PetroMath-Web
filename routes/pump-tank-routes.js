// routes/pump-tank-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const appSecurity = require('../utils/app-security');
const pumpTankController = require('../controllers/pump-tank-controller');

// Main page - render the tabbed interface
router.get('/', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.renderPumpTankMaster
);

// API endpoints for fetching data
router.get('/api/tanks', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getTanks
);

router.get('/api/pumps', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getPumps
);

router.get('/api/relations', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getPumpTankRelations
);

router.get('/api/products', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getProducts
);


// Tank CRUD operations
router.post('/api/tanks', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.createTank
);

router.get('/api/tanks/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getTankById
);

router.put('/api/tanks/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.updateTank
);

router.put('/api/tanks/:id/deactivate', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.deactivateTank
);


// Pump CRUD operations
router.post('/api/pumps', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.createPump
);

router.get('/api/pumps/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getPumpById
);

router.put('/api/pumps/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.updatePump
);


// Pump-Tank Relationship CRUD operations
router.post('/api/relations', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.createRelation
);

router.get('/api/relations/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getRelationById
);

router.put('/api/relations/:id', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.updateRelation
);

router.put('/api/relations/:id/deactivate', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.deactivateRelation
);

// Helper endpoints for relationship creation
router.get('/api/available-pumps', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getAvailablePumps
);

router.get('/api/available-tanks', 
    isLoginEnsured,
    appSecurity.hasPermission('MANAGE_PUMP_TANK_MASTER'),
    pumpTankController.getAvailableTanks
);

module.exports = router;