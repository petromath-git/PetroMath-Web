// routes/credit-master-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const creditController = require('../controllers/credit-controller');
const CreditDao = require('../dao/credits-dao');
const PersonDao = require('../dao/person-dao');
const dbMapping = require("../db/ui-db-field-mapping")
const lookupDao = require('../dao/lookup-dao');
const rolePermissionsDao = require('../dao/role-permissions-dao');

// ===== CREDIT CUSTOMER ROUTES =====

// Display credit customers page (excludes digital)
router.get('/', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const credits = await creditController.findCreditCustomersOnly(req.user.location_code);
        const customerTypes = await lookupDao.getCustomerTypes(req.user.location_code);
        
        // Check individual permissions for UI
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
        
        res.render('credits', { 
            title: 'Customer Master', 
            user: req.user, 
            credits: credits,
            customerTypes: customerTypes,
            canEdit: canEdit,
            canAdd: canAdd,
            canDisable: canDisable
        });
    } catch (error) {
        console.error('Error loading customer master:', error);
        res.status(500).send('Error loading customer master page');
    }
});


// Create new credit customer
router.post('/', [isLoginEnsured, security.hasPermission('ADD_CUSTOMER_MASTER')], async function (req, res, next) {
    try {

        // Check if customer already exists
        const existingCustomer = await CreditDao.findByNameAndLocation(companyName, locationCode);
        
        if (existingCustomer) {
            req.flash('error', `Customer "${companyName}" already exists at this location`);
            return res.redirect('/credit-master');
        }

        // If type not provided (hidden field), use default
        if (!req.body.m_credit_type_0) {
            const defaultType = await lookupDao.getDefaultCustomerType(req.user.location_code);
            req.body.m_credit_type_0 = defaultType;
        }    


        const newCredit = await CreditDao.create(dbMapping.newCredit(req));
        await PersonDao.createUserForCredit(newCredit, req.user);
        
        req.flash('success', 'Credit customer created successfully');
        res.redirect('/credit-master');
    } catch (error) {
        console.error('Error creating credit:', error);
        req.flash('error', 'Error creating credit customer');
        res.redirect('/credit-master');
    }
});


// API endpoint for updating customer
router.put('/api/:id', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const creditlistId = req.params.id;
        const newCompanyName = req.body.Company_Name;
        const locationCode = req.user.location_code;
        
        // Check for duplicate company name (excluding current customer)
        if (newCompanyName) {
            const existing = await CreditDao.findByNameAndLocation(newCompanyName, locationCode);
            
            if (existing && existing.creditlist_id != creditlistId) {
                return res.status(400).json({
                    success: false,
                    error: `Customer "${newCompanyName}" already exists at this location`
                });
            }
        }
        
        const updateData = {
            Company_Name: req.body.Company_Name,
            short_name: req.body.short_name,
            address: req.body.address,
            phoneno: req.body.phoneno,
            gst: req.body.gst,
            updated_by: req.user.Person_id,
            updation_date: new Date()
        };
        
        const result = await CreditDao.update(creditlistId, updateData);
        
        if (result && result[0] === 1) {
            res.json({
                success: true,
                message: 'Customer updated successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Customer not found or no changes made'
            });
        }
    } catch (error) {
        console.error('Error updating customer:', error);
        
        // Handle unique constraint violation from database
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({
                success: false,
                error: 'A customer with this name already exists at this location'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to update customer: ' + error.message
        });
    }
});

// Display disabled credit customers
router.get('/enable', [isLoginEnsured, security.hasPermission('DISABLE_CUSTOMER_MASTER')], function (req, res, next) {
    creditController.findDisableCreditCustomersOnly(req.user.location_code)
        .then(data => {
            res.render('enable_credit', {
                title: 'Disabled Credits',
                user: req.user,
                users: data
            });
        })
        .catch(err => {
            console.error("Error fetching disabled credits:", err);
            res.status(500).send("An error occurred.");
        });
});

// Enable specific credit customer
router.put('/enable/:id', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], function (req, res, next) {
    const creditID = req.params.id;
    
    CreditDao.enableCredit(creditID)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ 
                    success: true, 
                    message: 'Credit enabled successfully.' 
                });
            } else {
                res.status(400).send({ 
                    success: false, 
                    error: 'Error enabling credit.' 
                });
            }
        })
        .catch(error => {
            console.error('Error enabling credit:', error);
            res.status(500).send({ 
                success: false, 
                error: 'Error enabling credit.' 
            });
        });
});



// Disable specific credit customer
router.put('/disable/:id', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    const creditID = req.params.id;
    
    CreditDao.disableCredit(creditID)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ 
                    message: 'Credit disabled successfully.' 
                });
            } else {
                res.status(500).send({ 
                    error: 'Error disabling credit.' 
                });
            }
        })
        .catch(error => {
            console.error('Error disabling credit:', error);
            res.status(500).send({ 
                error: 'Error disabling credit.' 
            });
        });
});

// ===== DIGITAL CUSTOMER ROUTES =====

// Display digital customers page
router.get('/digital', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    creditController.findDigitalCustomers(req.user.location_code)
        .then(data => {
            res.render('digital', { 
                title: 'Digital Master', 
                user: req.user, 
                digitalCustomers: data,
                messages: req.flash()
            });
        })
        .catch(err => {
            console.error('Error fetching digital customers:', err);
            req.flash('error', 'Error loading digital customers');
            res.redirect('/home');
        });
});

// Create new digital customer
router.post('/digital', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    req.body.card_flag = 'Y';
    
    CreditDao.create(dbMapping.newDigitalCustomer(req))
        .then(() => {
            req.flash('success', 'Digital customer created successfully');
            res.redirect('/credit-master/digital');
        })
        .catch(error => {
            console.error('Error creating digital customer:', error);
            req.flash('error', 'Error creating digital customer');
            res.redirect('/credit-master/digital');
        });
});

// Display disabled digital customers
router.get('/digital/enable', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    creditController.findDisableDigitalCustomers(req.user.location_code)
        .then(data => {
            res.render('enable_digital', {
                title: 'Disabled Digital Customers',
                user: req.user,
                digitalCustomers: data
            });
        })
        .catch(err => {
            console.error("Error fetching disabled digital customers:", err);
            res.status(500).send("An error occurred.");
        });
});

// Enable specific digital customer
router.put('/digital/enable/:id', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    const digitalId = req.params.id;
    
    CreditDao.enableCredit(digitalId)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ 
                    success: true, 
                    message: 'Digital customer enabled successfully.' 
                });
            } else {
                res.status(400).send({ 
                    success: false, 
                    error: 'Error enabling digital customer.' 
                });
            }
        })
        .catch(err => {
            console.error('Error enabling digital customer:', err);
            res.status(500).send({ 
                success: false, 
                error: 'Error enabling digital customer.' 
            });
        });
});

// Disable specific digital customer
router.put('/digital/disable/:id', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    const digitalId = req.params.id;
    
    CreditDao.disableCredit(digitalId)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ 
                    message: 'Digital customer disabled successfully.' 
                });
            } else {
                res.status(500).send({ 
                    error: 'Error disabling digital customer.' 
                });
            }
        })
        .catch(err => {
            console.error('Error disabling digital customer:', err);
            res.status(500).send({ 
                error: 'Error disabling digital customer.' 
            });
        });
});


router.get('/check-duplicate', [isLoginEnsured, security.isAdmin()], async function (req, res) {
    try {
        const companyName = req.query.name;
        const locationCode = req.user.location_code;
        
        const exists = await CreditDao.findByNameAndLocation(companyName, locationCode);
        
        res.json({ exists: !!exists });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;