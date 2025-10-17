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

module.exports = router;