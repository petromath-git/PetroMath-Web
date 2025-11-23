// controllers/adjustment-controller.js
const adjustmentDao = require('../dao/adjustments-dao');
const moment = require('moment');
const locationConfig = require('../utils/location-config');

module.exports = {

    // GET /adjustments - Display the adjustment entry page
    getAdjustmentEntryPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const currentDate = moment().format('YYYY-MM-DD');

            // Fetch all required data in parallel
            const [
                adjustmentTypes,
                customerList,
                digitalVendorList,
                supplierList,
                bankList,
                expenseList                
            ] = await Promise.all([
                adjustmentDao.getAdjustmentTypes(),
                adjustmentDao.getCustomers(locationCode),
                adjustmentDao.getDigitalVendors(locationCode),
                adjustmentDao.getSuppliers(locationCode),
                adjustmentDao.getBankAccounts(locationCode),
                adjustmentDao.getExpenseCategories()               
            ]);

            // Process data for frontend
            const processedData = {
                adjustmentTypes: adjustmentTypes.map(type => ({
                    lookup_id: type.lookup_id,
                    description: type.description
                })),
                customerList: customerList.map(customer => ({
                    creditlist_id: customer.creditlist_id,
                    Company_Name: customer.Company_Name,
                    ledger_name: customer.ledger_name
                })),
                digitalVendorList: digitalVendorList.map(vendor => ({
                    creditlist_id: vendor.creditlist_id,
                    Company_Name: vendor.Company_Name,
                    ledger_name: vendor.ledger_name
                })),
                supplierList: supplierList.map(supplier => ({
                    supplier_id: supplier.supplier_id,
                    supplier_name: supplier.supplier_name,
                    supplier_short_name: supplier.supplier_short_name
                })),
                bankList: bankList.map(bank => ({
                    bank_id: bank.bank_id,
                    bank_name: bank.bank_name,
                    account_nickname: bank.account_nickname,
                    ledger_name: bank.ledger_name
                })),
                expenseList: expenseList.map(expense => ({
                    expense_id: expense.lookup_id,
                    expense_name: expense.description
                }))
            };

            res.render('adjustments-entry', {
                title: 'Credit/Debit Adjustment Entry',
                user: req.user,
                currentDate,
                ...processedData,
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getAdjustmentEntryPage:', error);
            req.flash('error', 'Failed to load adjustment entry page: ' + error.message);
            res.redirect('/adjustments');
        }
    },

    // POST /adjustments - Save adjustment entry
    saveAdjustment: async (req, res, next) => {
        try {

            const locationCode = req.user.location_code;
            const userName = req.user.User_Name;

            // Extract form data
            const adjustmentData = {
                adjustment_date: req.body.adjustment_date,
                location_code: locationCode,
                reference_no: req.body.reference_no || null,
                description: req.body.description,
                external_id: req.body.account_name ? parseInt(req.body.account_name) : null,
                external_source: req.body.account_type,
                ledger_name: req.body.ledger_name || null,
                debit_amount: req.body.debit_amount ? parseFloat(req.body.debit_amount) : null,
                credit_amount: req.body.credit_amount ? parseFloat(req.body.credit_amount) : null,
                adjustment_type: req.body.adjustment_type,
                status: 'ACTIVE',
                created_by: userName,
                updated_by: userName
            };

            // Validation
            const validationResult = await validateAdjustmentData(adjustmentData, locationCode);
            if (!validationResult.isValid) {
                req.flash('error', validationResult.message);
                return res.redirect('/adjustments');
            }

            // Save adjustment
            const savedAdjustment = await adjustmentDao.saveAdjustment(adjustmentData);

            req.flash('success', `Adjustment entry saved successfully! Reference ID: ${savedAdjustment.adjustment_id}`);
            res.redirect('/adjustments');

        } catch (error) {
            console.error('Error in saveAdjustment:', error);
            req.flash('error', 'Failed to save adjustment: ' + error.message);
            res.redirect('/adjustments/new'); 
        }
    },

    // GET /adjustments/api/accounts/:accountType - Get accounts by type (AJAX)
    getAccountsByType: async (req, res, next) => {
        try {
            const accountType = req.params.accountType;
            const locationCode = req.user.location_code;
            let accounts = [];

            switch (accountType) {
                case 'CUSTOMER':
                    accounts = await adjustmentDao.getCustomers(locationCode);
                    accounts = accounts.map(customer => ({
                        id: customer.creditlist_id,
                        name: customer.Company_Name,
                        ledger_name: customer.ledger_name,
                        source: 'CUSTOMER'
                    }));
                    break;

                case 'DIGITAL_VENDOR':
                    accounts = await adjustmentDao.getDigitalVendors(locationCode);
                    accounts = accounts.map(vendor => ({
                        id: vendor.creditlist_id,
                        name: vendor.Company_Name,
                        ledger_name: vendor.ledger_name,
                        source: 'DIGITAL_VENDOR'
                    }));
                    break;

                case 'SUPPLIER':
                    accounts = await adjustmentDao.getSuppliers(locationCode);
                    accounts = accounts.map(supplier => ({
                        id: supplier.supplier_id,
                        name: supplier.supplier_name,
                        ledger_name: supplier.supplier_name,
                        source: 'SUPPLIER'
                    }));
                    break;

                case 'BANK':
                    accounts = await adjustmentDao.getBankAccounts(locationCode);
                    accounts = accounts.map(bank => ({
                        id: bank.bank_id,
                        name: bank.account_nickname || bank.bank_name,
                        ledger_name: bank.ledger_name,
                        source: 'BANK'
                    }));
                    break;

                case 'EXPENSE':
                    accounts = await adjustmentDao.getExpenseCategories();
                    accounts = accounts.map(expense => ({
                        id: expense.lookup_id,
                        name: expense.description,
                        ledger_name: expense.description,
                        source: 'EXPENSE'
                    }));
                    break;

                default:
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid account type'
                    });
            }

            res.json({
                success: true,
                data: accounts
            });

        } catch (error) {
            console.error('Error in getAccountsByType:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch accounts: ' + error.message
            });
        }
    },

    // GET /adjustments/api/adjustment-types - Get adjustment types (AJAX)
    getAdjustmentTypes: async (req, res, next) => {
        try {
            const adjustmentTypes = await adjustmentDao.getAdjustmentTypes();
            
            res.json({
                success: true,
                data: adjustmentTypes
            });

        } catch (error) {
            console.error('Error in getAdjustmentTypes:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch adjustment types: ' + error.message
            });
        }
    },

    
    // Main list page (what managers see)
        getAdjustmentListPage: async (req, res, next) => {
            try {
                const locationCode = req.user.location_code;
                
                // Get all data needed for filters and dropdowns
                const [
                    adjustmentTypes,
                    customerList,
                    digitalVendorList,
                    supplierList,
                    bankList,
                    expenseList
                ] = await Promise.all([
                    adjustmentDao.getAdjustmentTypes(),
                    adjustmentDao.getCustomers(locationCode),
                    adjustmentDao.getDigitalVendors(locationCode),
                    adjustmentDao.getSuppliers(locationCode),
                    adjustmentDao.getBankAccounts(locationCode),
                    adjustmentDao.getExpenseCategories()
                ]);

                // Process data for frontend (same as entry page)
                const processedData = {
                    adjustmentTypes: adjustmentTypes.map(type => ({
                        lookup_id: type.lookup_id,
                        description: type.description
                    })),
                    customerList: customerList.map(customer => ({
                        creditlist_id: customer.creditlist_id,
                        Company_Name: customer.Company_Name,
                        ledger_name: customer.ledger_name
                    })),
                    digitalVendorList: digitalVendorList.map(vendor => ({
                        creditlist_id: vendor.creditlist_id,
                        Company_Name: vendor.Company_Name,
                        ledger_name: vendor.ledger_name
                    })),
                    supplierList: supplierList.map(supplier => ({
                        supplier_id: supplier.supplier_id,
                        supplier_name: supplier.supplier_name,
                        supplier_short_name: supplier.supplier_short_name
                    })),
                    bankList: bankList.map(bank => ({
                        bank_id: bank.bank_id,
                        bank_name: bank.bank_name,
                        account_nickname: bank.account_nickname,
                        ledger_name: bank.ledger_name
                    })),
                    expenseList: expenseList.map(expense => ({
                        expense_id: expense.lookup_id,
                        expense_name: expense.description
                    }))
                };


                    const currentDate = moment().format('YYYY-MM-DD');
                    const currentYear = moment().year();
                    const currentMonth = moment().month() + 1; // moment months are 0-based, convert to 1-based
                    
                    res.render('adjustments', {
                        title: 'Adjustments',
                        user: req.user,
                        currentDate,
                        currentYear,
                        currentMonth,
                        ...processedData,
                        messages: req.flash()
                    });

            } catch (error) {
                console.error('Error in getAdjustmentListPage:', error);
                req.flash('error', 'Failed to load adjustments page');
                res.redirect('/home');
            }
        },
    // GET /adjustments/list - Display adjustments list
    getAdjustmentList: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const fromDate = req.query.fromDate || moment().subtract(30, 'days').format('YYYY-MM-DD');
            const toDate = req.query.toDate || moment().format('YYYY-MM-DD');

            const filters = {
                locationCode,
                fromDate,
                toDate,
                adjustmentType: req.query.adjustmentType || null,
                externalSource: req.query.externalSource || null,
                status: req.query.status || 'ACTIVE'
            };

            const adjustmentsList = await adjustmentDao.getAdjustmentsList(filters);

            res.render('adjustments-list', {
                title: 'Adjustments History',
                user: req.user,
                adjustmentsList,
                filters,
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getAdjustmentList:', error);
            req.flash('error', 'Failed to load adjustments list: ' + error.message);
            res.redirect('/home');
        }
    },

    // POST /adjustments/api/list - Get adjustments list with filters (AJAX)
    getAdjustmentListAPI: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            
            const filters = {
                locationCode,
                fromDate: req.body.fromDate,
                toDate: req.body.toDate,
                adjustmentType: req.body.adjustmentType || null,
                externalSource: req.body.externalSource || null,
                status: req.body.status || 'ACTIVE',
                limit: req.body.limit || 100
            };

            const adjustmentsList = await adjustmentDao.getAdjustmentsList(filters);

            res.json({
                success: true,
                data: adjustmentsList
            });

        } catch (error) {
            console.error('Error in getAdjustmentListAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch adjustments list: ' + error.message
            });
        }
    },

    // GET /adjustments/:adjustmentId - Get adjustment details
    getAdjustmentDetails: async (req, res, next) => {
        try {
            const adjustmentId = req.params.adjustmentId;
            const adjustment = await adjustmentDao.getAdjustmentById(adjustmentId);

            if (!adjustment) {
                req.flash('error', 'Adjustment not found');
                return res.redirect('/adjustments/list');
            }

            res.render('adjustment-details', {
                title: 'Adjustment Details',
                user: req.user,
                adjustment,
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getAdjustmentDetails:', error);
            req.flash('error', 'Failed to load adjustment details: ' + error.message);
            res.redirect('/adjustments/list');
        }
    },

    // POST /adjustments/:adjustmentId/reverse - Reverse an adjustment
    reverseAdjustment: async (req, res, next) => {
        try {
            const adjustmentId = req.params.adjustmentId;
            const userName = req.user.User_Name;

            // Check if adjustment can be reversed
            const canModify = await adjustmentDao.canModifyAdjustment(adjustmentId);
            if (!canModify.canModify) {
                req.flash('error', canModify.reason);
                return res.redirect('/adjustments');
            }

            // Get original adjustment details
            const originalAdjustment = await adjustmentDao.getAdjustmentById(adjustmentId);
            if (!originalAdjustment) {
                req.flash('error', 'Adjustment not found');
                return res.redirect('/adjustments');
            }

            // Start transaction-like process
            try {
                // Step 1: Mark original as REVERSED
                await adjustmentDao.reverseAdjustment(adjustmentId, userName);
                
                // Step 2: Create reversal entry
                const reversalEntry = await adjustmentDao.createReversalEntry(originalAdjustment, userName);

                req.flash('success', `Adjustment #${adjustmentId} reversed successfully. Reversal entry #${reversalEntry.adjustment_id} created.`);
                res.redirect('/adjustments');

            } catch (error) {
                console.error('Error during reversal process:', error);
                req.flash('error', 'Failed to complete reversal process: ' + error.message);
                res.redirect('/adjustments');
            }

        } catch (error) {
            console.error('Error in reverseAdjustment:', error);
            req.flash('error', 'Failed to reverse adjustment: ' + error.message);
            res.redirect('/adjustments');
        }
    },

    // POST /adjustments/api/:adjustmentId/reverse - AJAX version for reversal
    reverseAdjustmentAPI: async (req, res, next) => {
        try {
            const adjustmentId = req.params.adjustmentId;
            const userName = req.user.User_Name;

            // Check if adjustment can be reversed
            const canModify = await adjustmentDao.canModifyAdjustment(adjustmentId);
            if (!canModify.canModify) {
                return res.status(400).json({
                    success: false,
                    error: canModify.reason
                });
            }

            // Get original adjustment details
            const originalAdjustment = await adjustmentDao.getAdjustmentById(adjustmentId);
            if (!originalAdjustment) {
                return res.status(404).json({
                    success: false,
                    error: 'Adjustment not found'
                });
            }

            // Perform reversal
            await adjustmentDao.reverseAdjustment(adjustmentId, userName);
            const reversalEntry = await adjustmentDao.createReversalEntry(originalAdjustment, userName);

            res.json({
                success: true,
                message: `Adjustment reversed successfully. Reversal entry #${reversalEntry.adjustment_id} created.`,
                reversalId: reversalEntry.adjustment_id
            });

        } catch (error) {
            console.error('Error in reverseAdjustmentAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reverse adjustment: ' + error.message
            });
        }
    }
};


// Helper function to validate adjustment data
async function validateAdjustmentData(data, locationCode) {
    // Check required fields
    if (!data.adjustment_date) {
        return { isValid: false, message: 'Adjustment date is required' };
    }

    if (!data.description || data.description.trim().length === 0) {
        return { isValid: false, message: 'Description is required' };
    }

    if (!data.external_source) {
        return { isValid: false, message: 'Account type is required' };
    }

    if (!data.external_id) {
        return { isValid: false, message: 'Account selection is required' };
    }

    if (!data.adjustment_type) {
        return { isValid: false, message: 'Adjustment type is required' };
    }

    // Check amount - must have either debit or credit, but not both
    const hasDebit = data.debit_amount && data.debit_amount > 0;
    const hasCredit = data.credit_amount && data.credit_amount > 0;

    if (!hasDebit && !hasCredit) {
        return { isValid: false, message: 'Either debit or credit amount is required' };
    }

    if (hasDebit && hasCredit) {
        return { isValid: false, message: 'Cannot enter both debit and credit amounts' };
    }

    // Check date is not in future
    const adjustmentDate = new Date(data.adjustment_date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (adjustmentDate > today) {
        return { isValid: false, message: 'Adjustment date cannot be in the future' };
    }

    // Check backdate limit from config
    const maxBackdateDays = Number(await locationConfig.getLocationConfigValue(
        locationCode,
        'ADJUSTMENT_MODIFY_MAX_DAYS',
        30  // default fallback
    ));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const daysDiff = Math.floor((todayStart - adjustmentDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > maxBackdateDays) {
        return { isValid: false, message: `Cannot create adjustments older than ${maxBackdateDays} days` };
    }

    return { isValid: true, message: null };
}