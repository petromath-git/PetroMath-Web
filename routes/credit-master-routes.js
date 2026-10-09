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
const BankDao = require('../dao/bank-dao');
const openingBalanceDao = require('../dao/customer-opening-balance-dao');

// Reads the opening balance fields posted by the modal / Add Customer form.
// Returns { date, amount (signed), note } or { error }.
function parseOpeningBalanceInput(body) {
    const raw = String(body.ob_amount === undefined || body.ob_amount === null ? '' : body.ob_amount).trim();
    const amount = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
        return { error: 'Enter the opening balance as a positive amount (0 if nothing was due).' };
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        return { error: 'Opening balance can have at most 2 decimals.' };
    }
    const direction = body.ob_direction === 'WE_OWE' ? -1 : 1;
    return {
        date: String(body.ob_date || '').slice(0, 10),
        amount: Math.round(amount * 100) / 100 * direction,
        note: body.ob_note
    };
}

// A non-digital customer of the user's location, or null
async function findOwnCustomer(id, locationCode) {
    const credit = await CreditDao.findById(id);
    if (!credit || credit.location_code !== locationCode || credit.card_flag === 'Y') return null;
    return credit;
}

// ===== CREDIT CUSTOMER ROUTES =====


// Display credit customers page (excludes digital)
router.get('/', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const credits = await creditController.findCreditCustomersOnly(req.user.location_code);
        const customerTypes = await lookupDao.getCustomerTypes(req.user.location_code);
        const banks = await BankDao.findAll(req.user.location_code); // ADD THIS LINE
        
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
        const [openingStatus, openingDateRules] = await Promise.all([
            openingBalanceDao.getLocationStatus(req.user.location_code),
            openingBalanceDao.getDateRules(req.user.location_code)
        ]);

        res.render('credits', {
            title: 'Customer Master',
            user: req.user,
            mobileReady: true,   // viewport tag + body.mobile-ready; table stacks into cards (m-stack)
            credits: credits,
            customerTypes: customerTypes,
            banks: banks,
            canEdit: canEdit,
            canAdd: canAdd,
            canDisable: canDisable,
            openingStatus: openingStatus,
            openingDateRules: openingDateRules,
            canChangeOpening: openingBalanceDao.EDIT_ROLES.includes(req.user.Role)
        });
    } catch (error) {
        console.error('Error loading customer master:', error);
        res.status(500).send('Error loading customer master page');
    }
});


// Create new credit customer
router.post('/', [isLoginEnsured, security.hasPermission('ADD_CUSTOMER_MASTER')], async function (req, res, next) {
    try {

        // Convert to uppercase before processing
        if (req.body.m_credit_name_0) {
            req.body.m_credit_name_0 = req.body.m_credit_name_0.toUpperCase();
        }
        if (req.body.m_credit_short_name_0) {
            req.body.m_credit_short_name_0 = req.body.m_credit_short_name_0.toUpperCase();
        }

        // Extract data from request - ADD THESE LINES
        const companyName = req.body.m_credit_name_0;
        const locationCode = req.user.location_code;
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

        // Opening balance is entered with the customer (₹0 by default); check it
        // before creating anything so a bad date doesn't leave a half-made customer
        const opening = parseOpeningBalanceInput(req.body);
        if (!opening.error) {
            opening.error = await openingBalanceDao.validateDate(locationCode, null, opening.date, null);
        }
        if (opening.error) {
            req.flash('error', `Customer not created: ${opening.error}`);
            return res.redirect('/credit-master');
        }

        const newCredit = await CreditDao.create(dbMapping.newCredit(req));
        await PersonDao.createUserForCredit(newCredit, req.user);
        await openingBalanceDao.save({
            locationCode,
            creditlistId: newCredit.creditlist_id,
            date: opening.date,
            amount: opening.amount,
            note: opening.note,
            userName: req.user.User_Name
        });

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

        // Convert to uppercase before processing
        if (req.body.Company_Name) {
            req.body.Company_Name = req.body.Company_Name.toUpperCase();
        }
        if (req.body.short_name) {
            req.body.short_name = req.body.short_name.toUpperCase();
        }

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
            short_name: req.body.short_name ? req.body.short_name : null,
            address: req.body.address,
            phoneno: req.body.phoneno,
            gst: req.body.gst,
            remittance_bank_id: req.body.remittance_bank_id && req.body.remittance_bank_id !== '' ? req.body.remittance_bank_id : null, // ADD THIS LINE
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
                mobileReady: true,   // page already has its own phone card view

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


// Create login account for a customer that has none yet (e.g. bulk-onboarded customers)
router.post('/api/:id/create-login', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const credit = await CreditDao.findById(req.params.id);
        if (!credit) {
            return res.status(404).json({ success: false, error: 'Customer not found' });
        }

        const existingPerson = await PersonDao.findPersonByCreditlistId(credit.creditlist_id);
        if (existingPerson) {
            return res.status(400).json({ success: false, error: 'Customer already has a login account' });
        }

        const person = await PersonDao.createUserForCredit(credit, req.user);

        const locationConfig = require('../utils/location-config');
        const defaultPassword = await locationConfig.getLocationConfigValue(
            credit.location_code, 'CUSTOMER_DEFAULT_PASSWORD', 'welcome123'
        );

        res.json({ success: true, username: person.User_Name, password: defaultPassword });
    } catch (error) {
        console.error('Error creating login for customer:', error);
        res.status(500).json({ success: false, error: 'Failed to create login account' });
    }
});

// Enable or disable customer portal login
router.put('/api/:id/toggle-login', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const { enable } = req.body; // true = enable, false = disable
        const person = await PersonDao.findPersonByCreditlistId(req.params.id);

        if (!person) {
            return res.status(404).json({ success: false, error: 'No login account found for this customer' });
        }

        const newEndDate = enable ? new Date('2099-12-31') : new Date('2000-01-01');
        await person.update({ effective_end_date: newEndDate, updated_by: req.user.User_Name, updation_date: new Date() });
        require('../utils/request-cache').invalidate('person:'); // session check in app.js deserializeUser

        res.json({ success: true, loginEnabled: enable });
    } catch (error) {
        console.error('Error toggling customer login:', error);
        res.status(500).json({ success: false, error: 'Failed to update login status' });
    }
});

// Get customer login info — checks if password is still the location default
router.get('/api/:id/login-info', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const bcrypt = require('bcrypt');
        const locationConfig = require('../utils/location-config');
        const person = await PersonDao.findPersonByCreditlistId(req.params.id);

        if (!person) {
            return res.status(404).json({ success: false, error: 'No login account found' });
        }

        const defaultPassword = await locationConfig.getLocationConfigValue(
            person.location_code, 'CUSTOMER_DEFAULT_PASSWORD', 'welcome123'
        );
        const passwordIsDefault = await bcrypt.compare(defaultPassword, person.Password);
        res.json({ success: true, username: person.User_Name, passwordIsDefault, defaultPassword });
    } catch (error) {
        console.error('Error fetching login info:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch login info' });
    }
});

// Reset customer login password to location default
router.put('/api/:id/reset-password', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const bcrypt = require('bcrypt');
        const locationConfig = require('../utils/location-config');

        const person = await PersonDao.findPersonByCreditlistId(req.params.id);

        if (!person) {
            return res.status(404).json({ success: false, error: 'No login account found for this customer' });
        }

        const defaultPassword = await locationConfig.getLocationConfigValue(
            person.location_code, 'CUSTOMER_DEFAULT_PASSWORD', 'welcome123'
        );
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        await PersonDao.updatePassword(person.Person_id, hashedPassword);

        res.json({ success: true, username: person.User_Name, password: defaultPassword });
    } catch (error) {
        console.error('Error resetting customer password:', error);
        res.status(500).json({ success: false, error: 'Failed to reset password' });
    }
});

// Opening balance of one customer, with its change history and date rules
router.get('/api/:id/opening-balance', [isLoginEnsured, security.hasPermission('VIEW_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const credit = await findOwnCustomer(req.params.id, req.user.location_code);
        if (!credit) return res.status(404).json({ success: false, error: 'Customer not found' });

        const [status, dateRules] = await Promise.all([
            openingBalanceDao.getStatus(credit.creditlist_id),
            openingBalanceDao.getDateRules(req.user.location_code)
        ]);
        const history = status.entry ? await openingBalanceDao.getHistory(status.entry.adjustment_id) : [];

        res.json({
            success: true,
            customerName: credit.Company_Name,
            status,
            history,
            dateRules,
            canChange: openingBalanceDao.EDIT_ROLES.includes(req.user.Role)
        });
    } catch (error) {
        console.error('Error loading opening balance:', error);
        res.status(500).json({ success: false, error: 'Failed to load opening balance' });
    }
});

// Set a customer's opening balance, or change it (Admin / PowerUser / SuperUser)
router.put('/api/:id/opening-balance', [isLoginEnsured, security.hasPermission('EDIT_CUSTOMER_MASTER')], async function (req, res) {
    try {
        const locationCode = req.user.location_code;
        const credit = await findOwnCustomer(req.params.id, locationCode);
        if (!credit) return res.status(404).json({ success: false, error: 'Customer not found' });

        const status = await openingBalanceDao.getStatus(credit.creditlist_id);
        if (status.state === 'MULTIPLE') {
            return res.status(400).json({ success: false, error: 'This customer has more than one opening balance entry. Delete the wrong one on the Adjustments screen first.' });
        }
        if (status.state === 'LEGACY') {
            return res.status(400).json({ success: false, error: 'This customer\'s opening balance comes from earlier records and cannot be changed here. Contact support.' });
        }

        let reason = null;
        if (status.entry) {
            if (!openingBalanceDao.EDIT_ROLES.includes(req.user.Role)) {
                return res.status(403).json({ success: false, error: 'Only Admin, PowerUser or SuperUser can change an opening balance once it is set.' });
            }
            if (status.entry.recon_match_id || status.entry.manual_recon_flag) {
                return res.status(400).json({ success: false, error: 'This opening balance is bank-reconciled; remove the reconciliation first.' });
            }
            reason = String(req.body.reason || '').trim().slice(0, 500);
            if (!reason) return res.status(400).json({ success: false, error: 'Please give a reason for the change.' });
        }

        const opening = parseOpeningBalanceInput(req.body);
        if (opening.error) return res.status(400).json({ success: false, error: opening.error });

        const dateError = await openingBalanceDao.validateDate(locationCode, credit.creditlist_id, opening.date, status);
        if (dateError) return res.status(400).json({ success: false, error: dateError });

        if (status.entry && status.entry.adjustment_date === opening.date
            && Number(status.entry.amount) === opening.amount
            && (status.entry.description || '') === ((opening.note || '').trim() || 'Opening Balance')) {
            return res.status(400).json({ success: false, error: 'Nothing changed.' });
        }

        await openingBalanceDao.save({
            locationCode,
            creditlistId: credit.creditlist_id,
            date: opening.date,
            amount: opening.amount,
            note: opening.note,
            userName: req.user.User_Name,
            reason
        });

        res.json({ success: true, message: status.entry ? 'Opening balance updated' : 'Opening balance saved' });
    } catch (error) {
        console.error('Error saving opening balance:', error);
        // DB go-live trigger messages are written for users
        const msg = error.parent && error.parent.sqlState === '45000' ? error.parent.sqlMessage : 'Failed to save opening balance';
        res.status(500).json({ success: false, error: msg });
    }
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