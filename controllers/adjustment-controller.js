// controllers/adjustment-controller.js
const adjustmentDao = require('../dao/adjustments-dao');
const moment = require('moment');
const locationConfig = require('../utils/location-config');
const locationDao = require('../dao/location-dao');
const customerOpeningBalanceDao = require('../dao/customer-opening-balance-dao');

module.exports = {

    // GET /adjustments/new - entry form now lives on the main Adjustments page
    getAdjustmentEntryPage: (req, res) => res.redirect('/adjustments'),

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
            res.redirect('/adjustments');
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
                    // Opening balances go on the day before the first shift (null before any shift)
                    const firstShift = await locationDao.getFirstShiftDate(locationCode);
                    const openingBalanceDate = firstShift ? moment(firstShift).subtract(1, 'day').format('YYYY-MM-DD') : null;
                    const currentMonth = moment().month() + 1; // moment months are 0-based, convert to 1-based
                    
                    res.render('adjustments', {
                        title: 'Adjustments',
                        user: req.user,
                        mobileReady: true,   // viewport tag + body.mobile-ready: phone entry form + history cards
                        currentDate,
                        currentYear,
                        currentMonth,
                        openingBalanceDate,
                        canEdit: adjustmentDao.DELETE_ROLES.includes(req.user.Role),
                        ...processedData,
                        messages: req.flash()
                    });

            } catch (error) {
                console.error('Error in getAdjustmentListPage:', error);
                req.flash('error', 'Failed to load adjustments page');
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
                search: (req.body.search || '').trim() || null,
                deleted: req.body.view === 'deleted',
                limit: req.body.limit || 200
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

    // POST /adjustments/api/:adjustmentId/delete - Delete an adjustment.
    // The row is archived to t_adjustments_deleted first so it can be restored;
    // the GL trigger on t_adjustments queues the reversal of any posting.
    deleteAdjustmentAPI: async (req, res, next) => {
        try {
            const adjustmentId = req.params.adjustmentId;

            const adjustment = await adjustmentDao.getAdjustmentById(adjustmentId);
            if (!adjustment || adjustment.location_code !== req.user.location_code) {
                return res.status(404).json({ success: false, error: 'Adjustment not found' });
            }

            const canModify = await adjustmentDao.canModifyAdjustment(adjustmentId, req.user.Role);
            if (!canModify.canModify) {
                return res.status(400).json({ success: false, error: canModify.reason });
            }

            const reason = (req.body.reason || '').trim().slice(0, 500);
            if (!reason) {
                return res.status(400).json({ success: false, error: 'Please give a reason for deleting' });
            }

            await adjustmentDao.archiveAndDeleteAdjustment(adjustmentId, req.user.User_Name, reason);

            res.json({ success: true, message: `Adjustment #${adjustmentId} deleted.` });

        } catch (error) {
            console.error('Error in deleteAdjustmentAPI:', error);
            res.status(500).json({ success: false, error: 'Failed to delete adjustment: ' + error.message });
        }
    },

    // POST /adjustments/api/:adjustmentId/restore - Undo a delete
    restoreAdjustmentAPI: async (req, res, next) => {
        try {
            const adjustmentId = req.params.adjustmentId;

            if (!adjustmentDao.DELETE_ROLES.includes(req.user.Role)) {
                return res.status(403).json({ success: false, error: 'You do not have permission to restore adjustments' });
            }

            const archived = await adjustmentDao.getDeletedAdjustmentById(adjustmentId);
            if (!archived || archived.location_code !== req.user.location_code) {
                return res.status(404).json({ success: false, error: 'Deleted adjustment not found' });
            }

            // A customer keeps one opening balance
            if (String(archived.adjustment_type) === '201' && archived.external_source === 'CUSTOMER') {
                const status = await customerOpeningBalanceDao.getStatus(archived.external_id);
                if (status.entries.length > 0) {
                    return res.status(400).json({ success: false, error: 'This customer already has an opening balance. Change it in Customer Master instead of restoring this one.' });
                }
            }

            await adjustmentDao.restoreAdjustment(adjustmentId, req.user.User_Name);

            res.json({ success: true, message: `Adjustment #${adjustmentId} restored.` });

        } catch (error) {
            console.error('Error in restoreAdjustmentAPI:', error);
            res.status(500).json({ success: false, error: 'Failed to restore adjustment: ' + error.message });
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

    // One opening balance per customer, kept in Customer Master
    if (String(data.adjustment_type) === '201' && data.external_source === 'CUSTOMER') {
        return { isValid: false, message: 'Customer opening balances are set in Customer Master (one per customer). Use General Adjustment for other corrections.' };
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

    const adjDate = String(data.adjustment_date).slice(0, 10);

    // Go-live rules (the DB triggers in golive-date-guard.sql enforce the same):
    // - Opening Balance Entry (type 201) before the first shift must be dated the
    //   day before it; that date is exempt from the backdate limit so a customer
    //   found weeks later can still get a correctly dated opening balance.
    // - Anything else may not be dated before go-live.
    if (String(data.adjustment_type) === '201') {
        const firstShift = await locationDao.getFirstShiftDate(locationCode);
        if (firstShift && adjDate < firstShift) {
            const openingDate = moment(firstShift).subtract(1, 'day').format('YYYY-MM-DD');
            if (adjDate !== openingDate) {
                return {
                    isValid: false,
                    message: `Opening balances must be dated ${moment(openingDate).format('DD-MMM-YYYY')}, the day before this location's PetroMath go-live (${moment(firstShift).format('DD-MMM-YYYY')}).`
                };
            }
            return { isValid: true, message: null };
        }
    } else {
        const goLiveDate = await locationDao.getGoLiveDate(locationCode);
        if (goLiveDate && adjDate < goLiveDate) {
            return {
                isValid: false,
                message: `Adjustment date is before this location's PetroMath go-live date (${moment(goLiveDate).format('DD-MMM-YYYY')}). Use an Opening Balance Entry for balances before go-live.`
            };
        }
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