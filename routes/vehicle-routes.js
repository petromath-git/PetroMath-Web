// routes/vehicle-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const creditVehiclesController = require('../controllers/credit-vehicles-controller');  // Import the controller

// Route to add a new vehicle
router.post('/', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    creditVehiclesController.saveVehicle(req, res, next);  // Calls the addVehicle method in the controller
});

// Route to get all vehicles for a credit party
router.post('/get', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    creditVehiclesController.getVehiclesByCreditlist(req, res, next);  // Calls the getVehiclesByCreditlist method
});

// Route to update a vehicle
router.put('/', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    creditVehiclesController.updateVehicle(req, res, next);  // Calls the updateVehicle method
});

// Route to delete a vehicle
router.delete('/', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    creditVehiclesController.deleteVehicle(req, res, next);  // Calls the deleteVehicle method
});

// Route to disable a vehicle
router.put('/disable-vehicle/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const vehicleId = req.params.id;  // Get vehicle ID from URL parameter
    req.body.vehicle_id = vehicleId;  // Add to body so controller can access it
    creditVehiclesController.disableVehicle(req, res, next);  // Calls the disableVehicle method
        
});

// Route to enable a vehicle
router.patch('/enable', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    creditVehiclesController.enableVehicle(req, res, next);  // Calls the enableVehicle method
});

module.exports = router;
