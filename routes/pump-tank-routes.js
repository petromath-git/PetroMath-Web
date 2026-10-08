// routes/pump-tank-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const appSecurity = require('../utils/app-security');
const pumpTankController = require('../controllers/pump-tank-controller');
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

// This screen only ever works on the location the user is logged in to.
// The controller reads location_code from req.query / req.body in many
// places, so pin both to the session location before any handler runs —
// whatever the browser sends is ignored.
router.use((req, res, next) => {
    if (req.user) {
        req.query.location_code = req.user.location_code;
        if (req.body && typeof req.body === 'object') req.body.location_code = req.user.location_code;
    }
    next();
});

// Record endpoints take an id only — make sure that tank / pump / link belongs
// to the session location before the controller reads or changes it.
const ownedBy = (table, idColumn) => async (req, res, next) => {
    try {
        if (!req.user) return next();
        const [row] = await db.sequelize.query(
            `SELECT 1 AS ok FROM ${table} WHERE ${idColumn} = :id AND location_code = :loc`,
            { replacements: { id: req.params.id, loc: req.user.location_code }, type: QueryTypes.SELECT }
        );
        if (!row) return res.status(404).json({ success: false, error: 'Not found at this location' });
        next();
    } catch (e) {
        next(e);
    }
};
router.use('/api/tanks/:id', ownedBy('m_tank', 'tank_id'));
router.use('/api/pumps/:id', ownedBy('m_pump', 'pump_id'));
router.use('/api/relations/:id', ownedBy('m_pump_tank', 'pump_tank_id'));

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