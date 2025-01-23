// routes/vehicle-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const security = require("../utils/app-security");
const vehicleController = require("../controllers/vehicle-controller");

const isLoginEnsured = login.ensureLoggedIn({});

// Get all vehicles for location
router.get('/:locationCode', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.findVehicles(req.params.locationCode)
        .then(data => {
            res.render('vehicles', { 
                title: 'Vehicles', 
                user: req.user, 
                vehicles: data,
                messages: req.flash()
            });
        })
        .catch(error => {
            console.error("Error fetching vehicles:", error);
            res.status(500).send("An error occurred.");
        });
});

// Get vehicles for a specific customer
router.get('/customer/:creditlist_id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.findVehiclesByCustomer(req.params.creditlist_id)
        .then(data => {
            res.json(data);
        })
        .catch(error => {
            res.status(500).json({ error: error.message });
        });
});

// Add new vehicle
router.post('/add', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const vehicleData = {
        ...req.body,
        created_by: req.user.Person_id,
        effective_start_date: new Date()
    };
    vehicleController.createVehicle(vehicleData)
        .then(result => {
            res.json({ success: true, data: result });
        })
        .catch(error => {
            res.status(500).json({ success: false, error: error.message });
        });
});

// Update vehicle
router.put('/update/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const vehicleData = {
        ...req.body,
        updated_by: req.user.Person_id
    };
    vehicleController.updateVehicle(req.params.id, vehicleData)
        .then(result => {
            res.json({ success: true, data: result });
        })
        .catch(error => {
            res.status(500).json({ success: false, error: error.message });
        });
});

// Disable vehicle
router.put('/disable/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.disableVehicle(req.params.id)
        .then(result => {
            res.json({ success: true, message: 'Vehicle disabled successfully.' });
        })
        .catch(error => {
            res.status(500).json({ success: false, error: error.message });
        });
});

// Get disabled vehicles page
router.get('/disabled/list', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.findDisabledVehicles(req.user.location_code)
        .then(data => {
            res.render('enable_vehicle', {
                title: 'Disabled Vehicles',
                user: req.user,
                vehicles: data,
                messages: req.flash()
            });
        })
        .catch(error => {
            console.error("Error fetching disabled vehicles:", error);
            res.status(500).send("An error occurred.");
        });
});

// Enable vehicle
router.put('/enable/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.enableVehicle(req.params.id)
        .then(result => {
            res.json({ success: true, message: 'Vehicle enabled successfully.' });
        })
        .catch(error => {
            res.status(500).json({ success: false, error: error.message });
        });
});

// Get vehicle details
router.get('/details/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    vehicleController.findVehicleById(req.params.id)
        .then(data => {
            if (!data) {
                res.status(404).json({ error: 'Vehicle not found' });
                return;
            }
            res.json(data);
        })
        .catch(error => {
            res.status(500).json({ error: error.message });
        });
});

module.exports = router;