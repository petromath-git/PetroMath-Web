const db = require("../db/db-connection");
const StockAdjustment = db.stock_adjustment;
const Product = db.product;
const { Sequelize, Op } = require("sequelize");

module.exports = {
    
    // Get all stock adjustments for a location
  // Get all stock adjustments for a location with filters
getStockAdjustmentsList: async (locationCode, filters = {}) => {
    try {
        let query = `
            SELECT 
                sa.adjustment_id,
                sa.adjustment_date,
                sa.adjustment_type,
                sa.qty,
                sa.remarks,
                sa.created_by,
                p.product_name,
                p.unit
            FROM t_lubes_stock_adjustment sa
            JOIN m_product p ON sa.product_id = p.product_id
            WHERE sa.location_code = ?
        `;
        
        const queryParams = [locationCode];

        // Add date filters
        if (filters.fromDate) {
            query += ' AND DATE(sa.adjustment_date) >= ?';
            queryParams.push(filters.fromDate);
        }
        
        if (filters.toDate) {
            query += ' AND DATE(sa.adjustment_date) <= ?';
            queryParams.push(filters.toDate);
        }

        // Add product filter
        if (filters.productId) {
            query += ' AND sa.product_id = ?';
            queryParams.push(filters.productId);
        }

        // Add adjustment type filter
        if (filters.adjustmentType) {
            query += ' AND sa.adjustment_type = ?';
            queryParams.push(filters.adjustmentType);
        }

        query += ' ORDER BY sa.adjustment_date DESC, sa.adjustment_id DESC LIMIT 500';

        return await db.sequelize.query(query, {
            replacements: queryParams,
            type: Sequelize.QueryTypes.SELECT
        });
    } catch (error) {
        console.error('Error fetching stock adjustments:', error);
        throw error;
    }
},

    // Get products not linked to pumps
    getProductsNotLinkedToPumps: async (locationCode) => {
        try {
            const query = `
                SELECT 
                    p.product_id,
                    p.product_name,
                    p.unit
                FROM m_product p
                WHERE p.location_code = ?
                AND p.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = ?
                )
                ORDER BY p.product_name
            `;
            
            return await db.sequelize.query(query, {
                replacements: [locationCode, locationCode],
                type: Sequelize.QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error fetching products:', error);
            throw error;
        }
    },

    // Get current stock balance for a product
    getCurrentStockBalance: async (productId, locationCode, date) => {
        try {
            const query = `
                SELECT get_closing_product_stock_balance(?, ?, ?) as current_stock
            `;
            
            const result = await db.sequelize.query(query, {
                replacements: [productId, locationCode, date],
                type: Sequelize.QueryTypes.SELECT
            });
            
            return result[0]?.current_stock || 0;
        } catch (error) {
            console.error('Error fetching current stock:', error);
            throw error;
        }
    },

    // Save new stock adjustment
    saveStockAdjustment: async (adjustmentData) => {
        try {
            const result = await StockAdjustment.create(adjustmentData);
            return result;
        } catch (error) {
            console.error('Error saving stock adjustment:', error);
            throw error;
        }
    }
};