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
                AND p.is_lube_product = 1
                ORDER BY p.product_name
            `;

            return await db.sequelize.query(query, {
                replacements: [locationCode, reportDate, locationCode],
                type: Sequelize.QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error fetching stock summary:', error);
            throw error;
        }
    },

    // Get the sum of OPENING adjustments for a product on a specific date
    // Used as fallback opening balance when the report starts from the very first tracking date
    getOpeningAdjustmentOnDate: async (productId, locationCode, date) => {
        try {
            const query = `
                SELECT COALESCE(SUM(qty), 0) as opening_qty
                FROM t_lubes_stock_adjustment
                WHERE product_id = ?
                  AND location_code = ?
                  AND adjustment_type = 'OPENING'
                  AND DATE(adjustment_date) = ?
            `;
            const result = await db.sequelize.query(query, {
                replacements: [productId, locationCode, date],
                type: Sequelize.QueryTypes.SELECT
            });
            const qty = result[0]?.opening_qty;
            return (qty !== null && qty !== undefined && parseFloat(qty) > 0)
                ? parseFloat(qty)
                : null;
        } catch (error) {
            console.error('Error fetching opening adjustment:', error);
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

              
            
            const balance = result[0]?.stock_balance;
            return balance !== null && balance !== undefined ? balance : null;
        } catch (error) {
            console.error('Error fetching stock balance:', error);
            throw error;
        }
    },

    // Get stock ledger (detailed transactions) for a product
    // Get stock ledger - just transactions between dates
getStockLedger: async (productId, locationCode, fromDate, toDate) => {
    try {
        const query = `
            SELECT * FROM (
                -- Purchases
                SELECT
                    hdr.invoice_date as txn_date,
                    CONVERT('PURCHASE' USING utf8mb4) as txn_type,
                    CONVERT(COALESCE(hdr.invoice_number, '') USING utf8mb4) as reference_no,
                    li.qty as quantity,
                    0 as out_qty,
                    li.qty as in_qty,
                    CONVERT(COALESCE(s.supplier_name, '') USING utf8mb4) as party_name,
                    li.net_rate as rate,
                    (li.qty * li.net_rate) as amount
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
                    CONVERT('CASH SALE' USING utf8mb4) as txn_type,
                    CONVERT(COALESCE(cs.bill_no, '') USING utf8mb4) as reference_no,
                    cs.qty as quantity,
                    cs.qty as out_qty,
                    0 as in_qty,
                    CONVERT('Cash Sale' USING utf8mb4) as party_name,
                    cs.price as rate,
                    cs.amount as amount
                FROM t_cashsales cs
                JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE cs.product_id = ?
                AND c.location_code = ?
                AND DATE(c.closing_date) BETWEEN ? AND ?

                UNION ALL

                -- Credit Sales
                SELECT
                    c.closing_date as txn_date,
                    CONVERT('CREDIT SALE' USING utf8mb4) as txn_type,
                    CONVERT(COALESCE(cr.bill_no, '') USING utf8mb4) as reference_no,
                    cr.qty as quantity,
                    cr.qty as out_qty,
                    0 as in_qty,
                    CONVERT(COALESCE(cl.Company_Name, '') USING utf8mb4) as party_name,
                    cr.price as rate,
                    cr.amount as amount
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
                    CONVERT('2T OIL' USING utf8mb4) as txn_type,
                    CONVERT('' USING utf8mb4) as reference_no,
                    (o.given_qty - o.returned_qty) as quantity,
                    (o.given_qty - o.returned_qty) as out_qty,
                    0 as in_qty,
                    CONVERT('2T Oil Distribution' USING utf8mb4) as party_name,
                    o.price as rate,
                    ((o.given_qty - o.returned_qty) * o.price) as amount
                FROM t_2toil o
                JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE o.product_id = ?
                AND c.location_code = ?
                AND DATE(c.closing_date) BETWEEN ? AND ?
                AND (o.given_qty - o.returned_qty) > 0

                UNION ALL

                -- Meter Sales (metered lube products like 2T LOOSE and MAK ADBLUE - LOOSE)
                -- Returns no rows for regular lube products (no m_pump row will match)
                SELECT
                    c.closing_date as txn_date,
                    CONVERT('METER SALE' USING utf8mb4) as txn_type,
                    CONVERT(CAST(c.closing_id AS CHAR) USING utf8mb4) as reference_no,
                    SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) as quantity,
                    SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) as out_qty,
                    0 as in_qty,
                    CONVERT('Meter Sale' USING utf8mb4) as party_name,
                    MAX(r.price) as rate,
                    SUM((r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) * r.price) as amount
                FROM t_reading r
                JOIN t_closing c ON r.closing_id = c.closing_id
                JOIN m_pump mp ON r.pump_id = mp.pump_id
                JOIN m_product p ON mp.product_code = p.product_name AND p.product_id = ?
                WHERE c.location_code = ?
                AND DATE(c.closing_date) BETWEEN ? AND ?
                AND (r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) > 0
                GROUP BY c.closing_date, c.closing_id

                UNION ALL

                -- Stock Adjustments (IN and OUT only — OPENING is the balance anchor, never a line item)
                SELECT
                    sa.adjustment_date as txn_date,
                    CONVERT(CONCAT('ADJUSTMENT ', sa.adjustment_type) USING utf8mb4) as txn_type,
                    CONVERT('' USING utf8mb4) as reference_no,
                    sa.qty as quantity,
                    CASE WHEN sa.adjustment_type = 'OUT' THEN sa.qty ELSE 0 END as out_qty,
                    CASE WHEN sa.adjustment_type = 'IN' THEN sa.qty ELSE 0 END as in_qty,
                    CONVERT(COALESCE(sa.remarks, '') USING utf8mb4) as party_name,
                    NULL as rate,
                    NULL as amount
                FROM t_lubes_stock_adjustment sa
                WHERE sa.product_id = ?
                AND sa.location_code = ?
                AND sa.adjustment_type IN ('IN', 'OUT')
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
                productId, locationCode, fromDate, toDate,  // Meter Sales
                productId, locationCode, fromDate, toDate   // Adjustments
            ],
            type: Sequelize.QueryTypes.SELECT
        });
    } catch (error) {
        console.error('Error fetching stock ledger:', error);
        throw error;
    }
},
// Get stock summary for all products (optimized)
getStockSummaryOptimized: async (locationCode, fromDate, toDate) => {
    try {
        const query = `CALL get_all_products_stock_summary(?, ?, ?)`;
        
        const results  = await db.sequelize.query(query, {
            replacements: [locationCode, fromDate, toDate]
            // DON'T specify type for stored procedures
        });
        
       
       
        
        return results;


    } catch (error) {
        console.error('Error fetching stock summary:', error);
        throw error;
    }
},

// Tank variance input data (tank dips + dip chart + pump readings + receipts)
getTankVarianceInputs: async (locationCode, fromDate, toDate) => {
    try {
        const fromStart = `${fromDate} 00:00:00`;

        const tanks = await db.sequelize.query(
            `SELECT tank_id, tank_code, product_code, dipchartid
             FROM m_tank
             WHERE location_code = :locationCode`,
            {
                replacements: { locationCode },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        const dipchartIds = [...new Set(tanks.map(t => t.dipchartid).filter(Boolean))];
        let dipChartLines = [];
        if (dipchartIds.length > 0) {
            dipChartLines = await db.sequelize.query(
                `SELECT dipchartid, dip_cm, volume_liters, diff_liters_mm
                 FROM m_tank_dipchart_lines
                 WHERE dipchartid IN (:dipchartIds)
                 ORDER BY dipchartid, dip_cm`,
                {
                    replacements: { dipchartIds },
                    type: Sequelize.QueryTypes.SELECT
                }
            );
        }

        const currentDips = await db.sequelize.query(
            `SELECT td.tdip_id,
                    td.tank_id,
                    DATE_FORMAT(td.dip_date, '%Y-%m-%d') AS dip_date,
                    TIME_FORMAT(td.dip_time, '%H:%i:%s') AS dip_time,
                    td.dip_reading
             FROM t_tank_dip td
             WHERE td.location_code = :locationCode
               AND DATE(td.dip_date) BETWEEN :fromDate AND :toDate`,
            {
                replacements: { locationCode, fromDate, toDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        const previousDips = await db.sequelize.query(
            `SELECT td.tdip_id,
                    td.tank_id,
                    DATE_FORMAT(td.dip_date, '%Y-%m-%d') AS dip_date,
                    TIME_FORMAT(td.dip_time, '%H:%i:%s') AS dip_time,
                    td.dip_reading
             FROM t_tank_dip td
             INNER JOIN (
                 SELECT tank_id,
                        MAX(CONCAT(DATE(dip_date), ' ', TIME(dip_time))) AS max_ts
                 FROM t_tank_dip
                 WHERE location_code = :locationCode
                   AND CONCAT(DATE(dip_date), ' ', TIME(dip_time)) < :fromStart
                 GROUP BY tank_id
             ) prev
             ON prev.tank_id = td.tank_id
             AND CONCAT(DATE(td.dip_date), ' ', TIME(td.dip_time)) = prev.max_ts
             WHERE td.location_code = :locationCode`,
            {
                replacements: { locationCode, fromStart },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        const allDipIds = [...new Set([...currentDips, ...previousDips].map(d => d.tdip_id))];
        let pumpReadings = [];
        if (allDipIds.length > 0) {
            pumpReadings = await db.sequelize.query(
                `SELECT tdip_id, pump_id, reading
                 FROM t_tank_reading
                 WHERE tdip_id IN (:allDipIds)`,
                {
                    replacements: { allDipIds },
                    type: Sequelize.QueryTypes.SELECT
                }
            );
        }

        const receipts = await db.sequelize.query(
            `SELECT dtl.tank_id,
                    DATE_FORMAT(rcpt.decant_date, '%Y-%m-%d') AS decant_date,
                    rcpt.decant_time,
                    SUM(dtl.quantity) AS quantity_kl
             FROM t_tank_stk_rcpt_dtl dtl
             INNER JOIN t_tank_stk_rcpt rcpt ON rcpt.ttank_id = dtl.ttank_id
             WHERE rcpt.location_code = :locationCode
               AND DATE(rcpt.decant_date) BETWEEN :fromDate AND :toDate
             GROUP BY dtl.tank_id, DATE(rcpt.decant_date), rcpt.decant_time`,
            {
                replacements: { locationCode, fromDate, toDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return {
            tanks,
            dipChartLines,
            currentDips,
            previousDips,
            pumpReadings,
            receipts
        };
    } catch (error) {
        console.error('Error fetching tank variance inputs:', error);
        throw error;
    }
},

};
