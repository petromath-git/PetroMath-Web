// controllers/stock-adjustment-controller.js
const stockAdjustmentDao = require('../dao/stock-adjustment-dao');
const moment = require('moment');

module.exports = {

    // GET /stock-adjustment/add - Display the stock adjustment entry page
    getStockAdjustmentEntryPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const currentDate = moment().format('YYYY-MM-DD');

            // Fetch products not linked to pumps
            const products = await stockAdjustmentDao.getProductsNotLinkedToPumps(locationCode);

            res.render('stock-adjustment-form', {
                title: 'Add Stock Adjustment',
                user: req.user,
                products: products,
                currentDate: currentDate,
                adjustment: null,
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getStockAdjustmentEntryPage:', error);
            req.flash('error', 'Failed to load stock adjustment entry page');
            res.redirect('/stock-adjustment');
        }
    },

  // GET /stock-adjustment - Display stock adjustments list
getStockAdjustmentListPage: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        
        // Get filter parameters
        const filters = {
            fromDate: req.query.fromDate || null,
            toDate: req.query.toDate || null,
            productId: req.query.productId || null,
            adjustmentType: req.query.adjustmentType || null
        };

        // Get all products for filter dropdown
        const products = await stockAdjustmentDao.getProductsNotLinkedToPumps(locationCode);
        
        // Get filtered adjustments
        const adjustmentsList = await stockAdjustmentDao.getStockAdjustmentsList(
            locationCode, 
            filters
        );

        // Format dates for display
        const formattedAdjustments = adjustmentsList.map(adj => ({
            ...adj,
            formatted_date: moment(adj.adjustment_date).format('DD-MMM-YYYY')
        }));

        res.render('stock-adjustment', {
            title: 'Stock Adjustments',
            user: req.user,
            adjustments: formattedAdjustments,
            products: products,
            filters: filters,
            messages: req.flash()
        });

    } catch (error) {
        console.error('Error in getStockAdjustmentListPage:', error);
        req.flash('error', 'Failed to load stock adjustments page');
        res.redirect('/home');
    }
},
    // POST /stock-adjustment/add - Save stock adjustment
    saveStockAdjustment: async (req, res, next) => {
        try {
            const {
                adjustment_date,
                product_id,
                adjustment_type,
                qty,
                remarks
            } = req.body;

            const locationCode = req.user.location_code;
            const userName = req.user.User_Name;

            // Validate adjustment data
            const validation = validateStockAdjustmentData(req.body);
            if (!validation.isValid) {
                req.flash('error', validation.message);
                return res.redirect('/stock-adjustment/add');
            }

            // Prepare adjustment data
            const adjustmentData = {
                adjustment_date: adjustment_date,
                product_id: product_id,
                adjustment_type: adjustment_type,
                qty: qty,
                remarks: remarks || null,
                location_code: locationCode,
                created_by: userName
            };

            // Save to database
            const savedAdjustment = await stockAdjustmentDao.saveStockAdjustment(adjustmentData);

            req.flash('success', `Stock adjustment saved successfully. Reference ID: ${savedAdjustment.adjustment_id}`);
            res.redirect('/stock-adjustment');

        } catch (error) {
            console.error('Error in saveStockAdjustment:', error);
            req.flash('error', 'Failed to save stock adjustment: ' + error.message);
            res.redirect('/stock-adjustment/add');
        }
    },

    // GET /stock-adjustment/api/current-stock/:productId - Get current stock (AJAX)
    getCurrentStock: async (req, res, next) => {
        try {
            const productId = req.params.productId;
            const locationCode = req.user.location_code;
            const today = moment().format('YYYY-MM-DD');

            const currentStock = await stockAdjustmentDao.getCurrentStockBalance(
                productId,
                locationCode,
                today
            );

            res.json({
                success: true,
                currentStock: parseFloat(currentStock).toFixed(2)
            });

        } catch (error) {
            console.error('Error in getCurrentStock:', error);
            res.json({
                success: false,
                error: 'Error fetching stock: ' + error.message
            });
        }
    },

    // POST /stock-adjustment/api/list - Get adjustments list with filters (AJAX)
    getStockAdjustmentListAPI: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            
            const filters = {
                locationCode,
                fromDate: req.body.fromDate,
                toDate: req.body.toDate,
                productId: req.body.productId || null,
                adjustmentType: req.body.adjustmentType || null,
                limit: req.body.limit || 100
            };

            const adjustmentsList = await stockAdjustmentDao.getStockAdjustmentsList(locationCode);

            res.json({
                success: true,
                data: adjustmentsList
            });

        } catch (error) {
            console.error('Error in getStockAdjustmentListAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch adjustments list: ' + error.message
            });
        }
    }
};

// Helper function to validate stock adjustment data
function validateStockAdjustmentData(data) {
    // Check required fields
    if (!data.adjustment_date) {
        return { isValid: false, message: 'Adjustment date is required' };
    }

    if (!data.product_id) {
        return { isValid: false, message: 'Product selection is required' };
    }

    if (!data.adjustment_type) {
        return { isValid: false, message: 'Adjustment type is required' };
    }

    if (!data.qty || parseFloat(data.qty) <= 0) {
        return { isValid: false, message: 'Quantity must be greater than 0' };
    }

    // Check date is not in future
    const adjustmentDate = new Date(data.adjustment_date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (adjustmentDate > today) {
        return { isValid: false, message: 'Adjustment date cannot be in the future' };
    }

    return { isValid: true, message: null };
}