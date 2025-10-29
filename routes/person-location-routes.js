// routes/person-location-routes.js
const express = require('express');
const router = express.Router();
const personLocationController = require('../controllers/person-location-controller');
const login = require('connect-ensure-login');
const security = require('../utils/app-security');

const isLoginEnsured = login.ensureLoggedIn('/login');

// GET: Render the assign locations page
router.get('/', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.renderPage
);

// GET: Get all persons (excluding customers)
router.get('/api/persons', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.getPersons
);

// GET: Get all locations
router.get('/api/locations', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.getLocations
);

// GET: Get all roles
router.get('/api/roles', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.getRoles
);

// GET: Get assigned locations for a person
router.get('/api/person/:personId/locations', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.getPersonLocations
);

// POST: Assign multiple locations to a person
router.post('/api/assign', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.assignLocations
);

// DELETE: Remove a location assignment
router.delete('/api/assignment/:personlocId', 
    [isLoginEnsured, security.hasPermission('ASSIGN_USER_LOCATIONS')],
    personLocationController.removeAssignment
);

module.exports = router;