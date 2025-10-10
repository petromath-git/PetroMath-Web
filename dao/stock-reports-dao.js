// dao/stock-reports-dao.js
const db = require("../db/db-connection");
const { Sequelize } = require("sequelize");

module.exports = {
    
    // Get stock summary for all products on a specific date
    getStockSummary: async (locationCode, reportDate) => {
        try {
            const query = `
                SELECT 
                    p.product_id,
                    p.product_name,
                    p.unit,
                    get_closing_product_stock_balance(p.product_id, ?, ?) as closing_stock
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
                replacements: [locationCode, reportDate, locationCode, locationCode],
                type: Sequelize.QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error fetching stock summary:', error);
            throw error;
        }
    },

    // Get stock balance for a product on a specific date
    getStockBalance: async (productId, locationCode, date) => {
        try {
            const query = `
                SELECT get_closing_product_stock_balance(?, ?, ?) as stock_balance
            `;
            
            const result = await db.sequelize.query(query, {
                replacements: [productId, locationCode, date],
                type: Sequelize.QueryTypes.SELECT
            });
            
            return result[0]?.stock_balance || 0;
        } catch (error) {
            console.error('Error fetching stock balance:', error);
            throw error;
        }
    },

    // Get stock ledger (detailed transactions) for a product
    getStockLedger: async (productId, locationCode, fromDate, toDate) => {
        try {
            const query = `
                SELECT * FROM (
                    -- Purchases
                    SELECT 
                        hdr.invoice_date as txn_date,
                        'PURCHASE' as txn_type,
                        hdr.invoice_number as reference_no,
                        li.qty as quantity,
                        0 as out_qty,
                        li.qty as in_qty,
                        s.supplier_name as party_name
                    FROM t_lubes_inv_lines li
                    JOIN t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                    LEFT JOIN m_supplier s ON hdr.supplier_id = s.supplier_id
                    WHERE li.product_id = ?
                    AND hdr.location_code = ?
                    AND DATE(hdr.invoice_date) BETWEEN ? AND ?
                    
                    UNION ALL
                    
                    -- Cash Sales
                    SELECT 
                        c.closing_date as txn_date,
                        'CASH SALE' as txn_type,
                        cs.bill_no as reference_no,
                        cs.qty as quantity,
                        cs.qty as out_qty,
                        0 as in_qty,
                        'Cash Sale' as party_name
                    FROM t_cashsales cs
                    JOIN t_closing c ON cs.closing_id = c.closing_id
                    WHERE cs.product_id = ?
                    AND c.location_code = ?
                    AND DATE(c.closing_date) BETWEEN ? AND ?
                    
                    UNION ALL
                    
                    -- Credit Sales
                    SELECT 
                        c.closing_date as txn_date,
                        'CREDIT SALE' as txn_type,
                        cr.bill_no as reference_no,
                        cr.qty as quantity,
                        cr.qty as out_qty,
                        0 as in_qty,
                        cl.Company_Name as party_name
                    FROM t_credits cr
                    JOIN t_closing c ON cr.closing_id = c.closing_id
                    LEFT JOIN m_credit_list cl ON cr.creditlist_id = cl.creditlist_id
                    WHERE cr.product_id = ?
                    AND c.location_code = ?
                    AND DATE(c.closing_date) BETWEEN ? AND ?
                    
                    UNION ALL
                    
                    -- 2T Oil
                    SELECT 
                        c.closing_date as txn_date,
                        '2T OIL' as txn_type,
                        '' as reference_no,
                        (o.given_qty - o.returned_qty) as quantity,
                        (o.given_qty - o.returned_qty) as out_qty,
                        0 as in_qty,
                        '2T Oil Distribution' as party_name
                    FROM t_2toil o
                    JOIN t_closing c ON o.closing_id = c.closing_id
                    WHERE o.product_id = ?
                    AND c.location_code = ?
                    AND DATE(c.closing_date) BETWEEN ? AND ?
                    AND (o.given_qty - o.returned_qty) > 0
                    
                    UNION ALL
                    
                    -- Stock Adjustments
                    SELECT 
                        sa.adjustment_date as txn_date,
                        CONCAT('ADJUSTMENT ', sa.adjustment_type) as txn_type,
                        '' as reference_no,
                        sa.qty as quantity,
                        CASE WHEN sa.adjustment_type = 'OUT' THEN sa.qty ELSE 0 END as out_qty,
                        CASE WHEN sa.adjustment_type = 'IN' THEN sa.qty ELSE 0 END as in_qty,
                        sa.remarks as party_name
                    FROM t_lubes_stock_adjustment sa
                    WHERE sa.product_id = ?
                    AND sa.location_code = ?
                    AND DATE(sa.adjustment_date) BETWEEN ? AND ?
                    
                ) as all_transactions
                ORDER BY txn_date, txn_type
            `;
            
            return await db.sequelize.query(query, {
                replacements: [
                    productId, locationCode, fromDate, toDate,  // Purchase
                    productId, locationCode, fromDate, toDate,  // Cash Sales
                    productId, locationCode, fromDate, toDate,  // Credit Sales
                    productId, locationCode, fromDate, toDate,  // 2T Oil
                    productId, locationCode, fromDate, toDate   // Adjustments
                ],
                type: Sequelize.QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error fetching stock ledger:', error);
            throw error;
        }
    }
};