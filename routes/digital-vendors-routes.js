const express = require('express');
const router = express.Router();
const digitalVendorsController = require('../controllers/digital-vendors-controller');
const security = require('../utils/app-security');
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn('/login');
const rolePermissionsDao = require('../dao/role-permissions-dao');

// Render Digital Vendor Master page
router.get('/', [isLoginEnsured], async function (req, res) {
    try {
        const locationCode = req.user.location_code;
        
        // Check individual permissions for UI
        const canEdit = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'EDIT_DIGITAL_VENDOR_MASTER'
        );
        const canAdd = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'ADD_DIGITAL_VENDOR_MASTER'
        );
        const canDisable = await rolePermissionsDao.hasPermission(
            req.user.Role, 
            req.user.location_code, 
            'DISABLE_DIGITAL_VENDOR_MASTER'
        );

        // Get vendors and banks
        const vendors = await digitalVendorsController.findDigitalVendors(locationCode);
        const banks = await digitalVendorsController.findBanksByLocation(locationCode);

        res.render('digital', {
            title: 'Digital Vendor Master',
            user: req.user,
            vendors: vendors,
            banks: banks,
            canAdd: canAdd,
            canEdit: canEdit,
            canDisable: canDisable
        });
    } catch (error) {
        console.error('Error loading digital vendor master:', error);
        res.status(500).send('Error loading digital vendor master page');
    }
});

// Create new digital vendor
router.post('/', [isLoginEnsured, security.hasPermission('ADD_DIGITAL_VENDOR_MASTER')], async function (req, res) {
    try {
        // Check for duplicate vendor name
        const isDuplicate = await digitalVendorsController.checkDuplicateVendor(
            req.body.company_name,
            req.user.location_code
        );

        if (isDuplicate) {
            req.flash('error', `Digital vendor "${req.body.company_name}" already exists at this location`);
            return res.redirect('/digital-vendors');
        }

        const vendorData = {
            location_code: req.user.location_code,
            company_name: req.body.company_name,
            short_name: req.body.short_name,
            ledger_name: req.body.ledger_name,
            remittance_bank_id: req.body.remittance_bank_id && req.body.remittance_bank_id !== '' ? req.body.remittance_bank_id : null,
            settlement_lookback_days: req.body.settlement_lookback_days && req.body.settlement_lookback_days !== '' ? req.body.settlement_lookback_days : null,
            gst: req.body.gst,
            phoneno: req.body.phoneno,
            address: req.body.address,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };

        await digitalVendorsController.createDigitalVendor(vendorData);
        
        req.flash('success', 'Digital vendor created successfully');
        res.redirect('/digital-vendors');
    } catch (error) {
        console.error('Error creating digital vendor:', error);
        console.error('Error details:', error.message);
        console.error('Vendor data:', req.body);
        req.flash('error', 'Error creating digital vendor: ' + error.message);
        res.redirect('/digital-vendors');
    }
});

// Update digital vendor
router.put('/:id', [isLoginEnsured, security.hasPermission('EDIT_DIGITAL_VENDOR_MASTER')], async function (req, res) {
    try {
        const vendorId = req.params.id;
        const vendorData = {
            company_name: req.body.company_name,
            short_name: req.body.short_name,
            ledger_name: req.body.ledger_name,
            remittance_bank_id: req.body.remittance_bank_id,
            settlement_lookback_days: req.body.settlement_lookback_days,
            gst: req.body.gst,
            phoneno: req.body.phoneno,
            address: req.body.address,
            updated_by: req.user.Person_id
        };

        const result = await digitalVendorsController.updateDigitalVendor(vendorId, vendorData);
        
        if (result > 0) {
            res.json({ success: true, message: 'Vendor updated successfully' });
        } else {
            res.status(404).json({ success: false, error: 'Vendor not found' });
        }
    } catch (error) {
        console.error('Error updating digital vendor:', error);
        res.status(500).json({ success: false, error: 'Error updating vendor' });
    }
});

// Disable digital vendor
router.put('/:id/disable', [isLoginEnsured, security.hasPermission('DISABLE_DIGITAL_VENDOR_MASTER')], async function (req, res) {
    try {
        const vendorId = req.params.id;
        const result = await digitalVendorsController.disableDigitalVendor(vendorId, req.user.Person_id);
        
        if (result > 0) {
            res.json({ success: true, message: 'Vendor disabled successfully' });
        } else {
            res.status(404).json({ success: false, error: 'Vendor not found' });
        }
    } catch (error) {
        console.error('Error disabling digital vendor:', error);
        res.status(500).json({ success: false, error: 'Error disabling vendor' });
    }
});

// View disabled digital vendors
router.get('/enable', [isLoginEnsured], async function (req, res) {
    try {
        const locationCode = req.user.location_code;
        const vendors = await digitalVendorsController.findDisabledDigitalVendors(locationCode);
        const banks = await digitalVendorsController.findBanksByLocation(locationCode);

        res.render('digital-enable', {
            title: 'Disabled Digital Vendors',
            user: req.user,
            vendors: vendors,
            banks: banks
        });
    } catch (error) {
        console.error('Error loading disabled vendors:', error);
        res.status(500).send('Error loading disabled vendors page');
    }
});

// Enable digital vendor
router.put('/:id/enable', [isLoginEnsured, security.hasPermission('EDIT_DIGITAL_VENDOR_MASTER')], async function (req, res) {
    try {
        const vendorId = req.params.id;
        const result = await digitalVendorsController.enableDigitalVendor(vendorId, req.user.Person_id);
        
        if (result > 0) {
            res.json({ success: true, message: 'Vendor enabled successfully' });
        } else {
            res.status(404).json({ success: false, error: 'Vendor not found' });
        }
    } catch (error) {
        console.error('Error enabling digital vendor:', error);
        res.status(500).json({ success: false, error: 'Error enabling vendor' });
    }
});

// Check for duplicate vendor name (for real-time validation)
router.get('/check-duplicate', [isLoginEnsured], async function (req, res) {
    try {
        const companyName = req.query.name;
        const locationCode = req.user.location_code;
        const excludeId = req.query.excludeId || null;
        
        if (!companyName) {
            return res.json({ exists: false });
        }
        
        const exists = await digitalVendorsController.checkDuplicateVendor(
            companyName,
            locationCode,
            excludeId
        );
        
        res.json({ exists: exists });
    } catch (error) {
        console.error('Error checking duplicate:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;