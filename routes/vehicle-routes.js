// routes/vehicle-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const creditVehiclesController = require('../controllers/credit-vehicles-controller');
const rolePermissionsDao = require('../dao/role-permissions-dao');
const CreditDao = require('../dao/credits-dao');
const ProductDao = require('../dao/product-dao');

// Display vehicles page with permission checks
router.post('/get', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function(req, res, next) {
    try {
        const creditlistId = req.body.creditlist_id;
        
        // Get customer info
        const customer = await CreditDao.findCreditDetails([creditlistId]);
        const customerInfo = customer && customer[0] ? customer[0] : null;
        
        // Get all vehicles for this customer
        const vehicles = await creditVehiclesController.getVehiclesForDisplay(creditlistId);
        
        // Get products for dropdown
        const products = await ProductDao.findPumpProducts(req.user.location_code);
        
        // Check permissions for UI
        const canEdit = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'EDIT_CUSTOMER_MASTER'
        );
        const canAdd = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'ADD_CUSTOMER_MASTER'
        );
        const canDisable = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'DISABLE_CUSTOMER_MASTER'
        );
        
        res.render('vehicles', {
            title: 'Vehicle Master',
            user: req.user,
            vehicles: vehicles,
            products: products,
            creditlist_id: creditlistId,
            customer: customerInfo,
            canEdit: canEdit,
            canAdd: canAdd,
            canDisable: canDisable
        });
    } catch (error) {
        console.error('Error loading vehicles page:', error);
        res.status(500).send('Error loading vehicles page');
    }
});


// Display vehicles page with GET request
router.get('/:creditlist_id', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function(req, res, next) {
    try {
        const creditlistId = req.params.creditlist_id;
        
        // Get customer info
        const customer = await CreditDao.findCreditDetails([creditlistId]);
        const customerInfo = customer && customer[0] ? customer[0] : null;
        
        // Get all vehicles for this customer
        const vehicles = await creditVehiclesController.getVehiclesForDisplay(creditlistId);
        
        // Get products for dropdown
        const products = await ProductDao.findPumpProducts(req.user.location_code);
        
        // Check permissions for UI
        const canEdit = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'EDIT_CUSTOMER_MASTER'
        );
        const canAdd = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'ADD_CUSTOMER_MASTER'
        );
        const canDisable = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'DISABLE_CUSTOMER_MASTER'
        );
        
        res.render('vehicles', {
            title: 'Vehicle Master',
            user: req.user,
            vehicles: vehicles,
            products: products,
            creditlist_id: creditlistId,
            customer: customerInfo,
            canEdit: canEdit,
            canAdd: canAdd,
            canDisable: canDisable
        });
    } catch (error) {
        console.error('Error loading vehicles page:', error);
        res.status(500).send('Error loading vehicles page');
    }
});


// Create new vehicle - ADD permission required
router.post('/', [isLoginEnsured, security.hasPermission('ADD_CUSTOMER_MASTER')], async function(req, res, next) {
    try {
        await creditVehiclesController.saveVehicle(req, res, next);
    } catch (error) {
        console.error('Error creating vehicle:', error);
        res.status(500).json({
            success: false,
            error: 'Error creating vehicle'
        });
    }
});

// Update vehicle - EDIT permission required
router.put('/api/:id', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function(req, res) {
    try {
        const vehicleId = req.params.id;
        const updateData = {
            vehicle_number: req.body.vehicle_number,
            vehicle_type: req.body.vehicle_type,
            product_id: req.body.product_id,
            updated_by: req.user.Person_id,
            updation_date: new Date()
        };
        
        const result = await creditVehiclesController.updateVehicleData(vehicleId, updateData);
        
        if (result) {
            res.json({
                success: true,
                message: 'Vehicle updated successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Vehicle not found or no changes made'
            });
        }
    } catch (error) {
        console.error('Error updating vehicle:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update vehicle: ' + error.message
        });
    }
});

// Disable vehicle - DISABLE permission required
router.put('/disable-vehicle/:id', [isLoginEnsured, security.hasPermission('DISABLE_CUSTOMER_MASTER')], function (req, res, next) {
    const vehicleId = req.params.id;
    req.body.vehicle_id = vehicleId;
    creditVehiclesController.disableVehicle(req, res, next);
});

// Enable vehicle - EDIT permission required
router.put('/enable-vehicle/:id', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], function(req, res, next) {
    const vehicleId = req.params.id;
    req.body.vehicle_id = vehicleId;
    creditVehiclesController.enableVehicle(req, res, next);
});


router.get('/disabled/:creditlist_id', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function(req, res) {
    try {
        const creditlistId = req.params.creditlist_id;
        const CreditVehiclesDao = require('../dao/credit-vehicles-dao');
        const disabledVehicles = await CreditVehiclesDao.findDisabled(creditlistId);
        
        res.json({
            success: true,
            vehicles: disabledVehicles
        });
    } catch (error) {
        console.error('Error fetching disabled vehicles:', error);
        res.status(500).json({ success: false, error: 'Error fetching disabled vehicles' });
    }
});

// Check for duplicate vehicle number
router.get('/check-duplicate', [isLoginEnsured], async function (req, res) {
    try {
        let vehicleNumber = req.query.vehicle_number?.trim().toUpperCase();
        const creditlistId = req.query.creditlist_id;
        const excludeId = req.query.excludeId;

        const CreditVehiclesDao = require('../dao/credit-vehicles-dao');
        const existing = await CreditVehiclesDao.findByNumberAndCustomer(vehicleNumber, creditlistId);

        if (existing && existing.vehicle_id != excludeId) {
            return res.json({ exists: true });
        }

        res.json({ exists: false });
    } catch (error) {
        console.error('Error checking duplicate:', error);
        res.status(500).json({ error: 'Error checking duplicate' });
    }
});

module.exports = router;