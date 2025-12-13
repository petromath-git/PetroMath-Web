const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {
    getBalance: (creditId, closingQueryFromDate,closingQueryToDate) => {     
        //console.log('in GetBalance')
        //console.log(closingQueryFromDate); 
        //console.log(closingQueryToDate); 
        return db.sequelize.query(
            "select get_opening_credit_balance("+ creditId + ",'"+ closingQueryFromDate+ "') as OpeningData,get_closing_credit_balance("+ creditId + ",'"+ closingQueryToDate+ "') as ClosingData",
            { type: Sequelize.QueryTypes.SELECT }           
        );
        
    },
    // getDayBalance: (locationCode,closingQueryToDate) => {             
    //     return db.sequelize.query(
    //         `select upper(mcl.company_name) company_name,get_closing_credit_balance(mcl.creditlist_id,:closing_date) as ClosingData
    //          from m_credit_list mcl where location_code = :locationCode
    //          and  COALESCE(mcl.card_flag,'N') <> 'Y' order by 2 desc `,
    //         {   replacements: { locationCode: locationCode,closing_date: closingQueryToDate}, 
    //              type: Sequelize.QueryTypes.SELECT }           
    //     );
        
    // }    ,   

    getDayBalance: (locationCode, closingQueryToDate) => {             
    return db.sequelize.query(
        `SELECT 
            mcl.creditlist_id,
            UPPER(mcl.company_name) company_name,
            get_closing_credit_balance(mcl.creditlist_id, :closing_date) as ClosingData,
            (SELECT MAX(tr.receipt_date) 
             FROM t_receipts tr 
             WHERE tr.creditlist_id = mcl.creditlist_id
             AND DATE(tr.receipt_date) <= :closing_date) as last_payment_date,
            (SELECT tr.amount 
             FROM t_receipts tr 
             WHERE tr.creditlist_id = mcl.creditlist_id
             AND DATE(tr.receipt_date) = (SELECT MAX(receipt_date) 
                                          FROM t_receipts 
                                          WHERE creditlist_id = mcl.creditlist_id
                                          AND DATE(receipt_date) <= :closing_date)
             LIMIT 1) as last_payment_amount,
            DATEDIFF(:closing_date, 
                    (SELECT MAX(tr.receipt_date) 
                     FROM t_receipts tr 
                     WHERE tr.creditlist_id = mcl.creditlist_id
                     AND DATE(tr.receipt_date) <= :closing_date)) as days_since_payment
         FROM m_credit_list mcl 
         WHERE location_code = :locationCode
         AND COALESCE(mcl.card_flag,'N') <> 'Y' 
         ORDER BY 3 DESC`,
        {   
            replacements: { 
                locationCode: locationCode,
                closing_date: closingQueryToDate
            }, 
            type: Sequelize.QueryTypes.SELECT 
        }           
    );
},
// getCreditStmt: (locationCode, closingQueryFromDate, closingQueryToDate, creditId) => {
//     return db.sequelize.query(
//         `SELECT 
//             tcl.closing_date AS tran_date,
//             tcl.location_code,
//             CONCAT('To Bill No: ', tc.bill_no) AS bill_no,
//             mcl.Company_Name AS company_name,
//             mp.product_name,
//             tc.price,
//             tc.price_discount,
//             tc.qty,
//             tc.amount,
//             tc.notes,
//             mcl.creditlist_id,
//             tc.odometer_reading,
//             mcv.vehicle_number
//         FROM t_credits tc
//         JOIN m_product mp ON tc.product_id = mp.product_id
//         JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
//         JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
//         LEFT JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
//         WHERE tcl.location_code = :locationCode
//             AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
//             AND (:creditId = -1 OR mcl.creditlist_id = :creditId)

//         UNION ALL

//         SELECT 
//             tr.receipt_date AS tran_date,
//             tr.location_code,
//             CONCAT('By Receipt No: ', tr.receipt_no) AS bill_no,
//             mcl.Company_Name AS company_name,
//             NULL AS product_name,
//             NULL AS price,
//             NULL AS price_discount,
//             NULL AS qty,
//             tr.amount,
//             tr.notes,
//             mcl.creditlist_id,
//             NULL AS odometer_reading,
//             NULL AS vehicle_number
//         FROM t_receipts tr
//         JOIN m_credit_list mcl ON mcl.creditlist_id = tr.creditlist_id
//         WHERE tr.location_code = :locationCode
//             AND DATE(tr.receipt_date) BETWEEN :fromDate AND :toDate
//             AND (:creditId = -1 OR mcl.creditlist_id = :creditId)

//         ORDER BY tran_date`,
//         {
//             replacements: { 
//                 locationCode: locationCode, 
//                 fromDate: closingQueryFromDate, 
//                 toDate: closingQueryToDate,
//                 creditId: creditId
//             },
//             type: Sequelize.QueryTypes.SELECT
//         }
//     );
// },
    // In dao/report-dao.js
// Updated getCreditStmt function in dao/report-dao.js


// Updated getCreditStmt function in dao/report-dao.js with transaction_type
getCreditStmt: (locationCode, closingQueryFromDate, closingQueryToDate, creditId) => {
    return db.sequelize.query(
        `SELECT 
            tcl.closing_date AS tran_date,
            tcl.location_code,
            CONCAT('To Bill No: ', tc.bill_no) AS bill_no,
            mcl.Company_Name AS company_name,
            mp.product_name,
            tc.price,
            tc.price_discount,
            tc.qty,
            tc.amount,
            tc.notes,
            mcl.creditlist_id,
            tc.odometer_reading,
            mcv.vehicle_number,
            'SALE' AS transaction_type
        FROM t_credits tc
        JOIN m_product mp ON tc.product_id = mp.product_id
        JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
        JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
        LEFT JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
        WHERE tcl.location_code = :locationCode
          AND mcl.creditlist_id = :creditId
          AND DATE(tcl.closing_date) BETWEEN :closingQueryFromDate AND :closingQueryToDate

        UNION ALL

        SELECT 
            tr.receipt_date AS tran_date,
            tr.location_code,
            CONCAT('By Receipt No: ', tr.receipt_no) AS bill_no,
            mcl.Company_Name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            tr.amount,
            tr.notes,
            mcl.creditlist_id,
            NULL AS odometer_reading,
            NULL AS vehicle_number,
            'RECEIPT' AS transaction_type
        FROM t_receipts tr
        JOIN m_credit_list mcl ON tr.creditlist_id = mcl.creditlist_id
        WHERE mcl.creditlist_id = :creditId
          AND DATE(tr.receipt_date) BETWEEN :closingQueryFromDate AND :closingQueryToDate
          AND tr.location_code = :locationCode

        UNION ALL

        -- NEW: Include adjustments with explicit transaction types
        SELECT 
            ta.adjustment_date AS tran_date,
            ta.location_code,
            CONCAT('Adjustment: ', COALESCE(ta.reference_no, ta.adjustment_id)) AS bill_no,
            mcl.Company_Name AS company_name,
            ta.description AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            COALESCE(ta.debit_amount, ta.credit_amount) AS amount,
            CONCAT(ta.adjustment_type, ' - ', ta.description) AS notes,
            mcl.creditlist_id,
            NULL AS odometer_reading,
            NULL AS vehicle_number,
            CASE 
                WHEN ta.debit_amount > 0 THEN 'ADJUSTMENT_DEBIT'
                WHEN ta.credit_amount > 0 THEN 'ADJUSTMENT_CREDIT'
                ELSE 'ADJUSTMENT'
            END AS transaction_type
        FROM t_adjustments ta
        JOIN m_credit_list mcl ON ta.external_id = mcl.creditlist_id
        WHERE ta.external_source IN ('CUSTOMER', 'DIGITAL_VENDOR')  -- Changed from 'CREDIT'
          AND ta.external_id = :creditId
          AND ta.status = 'ACTIVE'
          AND ta.location_code = :locationCode
          AND DATE(ta.adjustment_date) BETWEEN :closingQueryFromDate AND :closingQueryToDate

        ORDER BY tran_date, bill_no`,
        {
            replacements: { 
                locationCode: locationCode,
                creditId: creditId,
                closingQueryFromDate: closingQueryFromDate,
                closingQueryToDate: closingQueryToDate
            }, 
            type: db.Sequelize.QueryTypes.SELECT
        }
    );
},



// MODIFIED getDigitalStmt METHOD
// This version treats vendors with the same recon_group_id as ONE for reconciliation

getDigitalStmt: async (locationCode, fromDate, toDate, vendorId) => {
    const result = await db.sequelize.query(
        `-- DEBIT: Digital Sales
        SELECT 
            DATE_FORMAT(COALESCE(tds.transaction_date, tc.closing_date), '%d-%m-%Y') as tran_date,
            CONCAT('DS-', tds.digital_sales_id) as bill_no,
            tds.notes,
            mcl.company_name,
            'Digital Sale' as product_name,
            tds.amount,
            COALESCE(tds.transaction_date, tc.closing_date) as sort_date,
            'DEBIT' as entry_type,

            -- NEW recon fields
            't_digital_sales' AS source_table,
            tds.digital_sales_id AS source_id,
            tds.recon_match_id,
            tds.manual_recon_flag,
            tds.manual_recon_by,
            tds.manual_recon_date

        FROM t_digital_sales tds
        INNER JOIN t_closing tc ON tds.closing_id = tc.closing_id
        INNER JOIN m_credit_list mcl ON tds.vendor_id = mcl.creditlist_id
        WHERE tc.location_code = :locationCode
          AND DATE(COALESCE(tds.transaction_date, tc.closing_date)) BETWEEN :fromDate AND :toDate
          AND (
              tds.vendor_id = :vendorId
              OR tds.vendor_id IN (
                  SELECT creditlist_id 
                  FROM m_credit_list 
                  WHERE recon_group_id = (
                      SELECT recon_group_id 
                      FROM m_credit_list 
                      WHERE creditlist_id = :vendorId
                  )
                  AND recon_group_id IS NOT NULL
              )
          )


        UNION ALL

        -- DEBIT: Customer payments via digital vendor
        SELECT 
            DATE_FORMAT(tr.receipt_date, '%d-%m-%Y') as tran_date,
            tr.receipt_no as bill_no,
            CONCAT(
                tr.notes, 
                ' (Digital Payment by ', 
                COALESCE(mcl_payer.short_name, mcl_payer.company_name), 
                ')'
            ) as notes,
            mcl.company_name,
            NULL as product_name,
            tr.amount,
            tr.receipt_date as sort_date,
            'DEBIT' as entry_type,

            -- NEW recon fields
            't_receipts' AS source_table,
            tr.treceipt_id AS source_id,
            tr.recon_match_id,
            tr.manual_recon_flag,
            tr.manual_recon_by,
            tr.manual_recon_date

        FROM t_receipts tr
        INNER JOIN m_credit_list mcl ON tr.digital_creditlist_id = mcl.creditlist_id
        LEFT JOIN m_credit_list mcl_payer ON tr.creditlist_id = mcl_payer.creditlist_id
        WHERE tr.location_code = :locationCode
          AND DATE(tr.receipt_date) BETWEEN :fromDate AND :toDate
          AND (
              tr.digital_creditlist_id = :vendorId
              OR tr.digital_creditlist_id IN (
                  SELECT creditlist_id 
                  FROM m_credit_list 
                  WHERE recon_group_id = (
                      SELECT recon_group_id 
                      FROM m_credit_list 
                      WHERE creditlist_id = :vendorId
                  )
                  AND recon_group_id IS NOT NULL
              )
          )


        UNION ALL

        -- CREDIT: Payments from digital vendor to us
        SELECT 
            DATE_FORMAT(tr.receipt_date, '%d-%m-%Y') as tran_date,
            tr.receipt_no as bill_no,
            tr.notes,
            mcl.company_name,
            NULL as product_name,
            tr.amount,
            tr.receipt_date as sort_date,
            'CREDIT' as entry_type,

            -- NEW recon fields
            't_receipts' AS source_table,
            tr.treceipt_id AS source_id,
            tr.recon_match_id,
            tr.manual_recon_flag,
            tr.manual_recon_by,
            tr.manual_recon_date

        FROM t_receipts tr
        INNER JOIN m_credit_list mcl ON tr.creditlist_id = mcl.creditlist_id
        WHERE tr.location_code = :locationCode
          AND DATE(tr.receipt_date) BETWEEN :fromDate AND :toDate
          AND (
              tr.creditlist_id = :vendorId
              OR tr.creditlist_id IN (
                  SELECT creditlist_id 
                  FROM m_credit_list 
                  WHERE recon_group_id = (
                      SELECT recon_group_id 
                      FROM m_credit_list 
                      WHERE creditlist_id = :vendorId
                  )
                  AND recon_group_id IS NOT NULL
              )
          )


        UNION ALL

        -- Adjustments (both debit and credit)
        SELECT 
            DATE_FORMAT(ta.adjustment_date, '%d-%m-%Y') as tran_date,
            CONCAT('ADJ-', ta.adjustment_id) as bill_no,
            ta.description as notes,
            mcl.company_name,
            NULL as product_name,
            COALESCE(ta.debit_amount, ta.credit_amount) as amount,
            ta.adjustment_date as sort_date,
            CASE 
                WHEN ta.debit_amount > 0 THEN 'DEBIT'
                ELSE 'CREDIT'
            END as entry_type,

            -- NEW recon fields
            't_adjustments' AS source_table,
            ta.adjustment_id AS source_id,
            ta.recon_match_id,
            ta.manual_recon_flag,
            ta.manual_recon_by,
            ta.manual_recon_date

        FROM t_adjustments ta
        INNER JOIN m_credit_list mcl ON ta.external_id = mcl.creditlist_id
        WHERE ta.external_source = 'DIGITAL_VENDOR'
          AND ta.status = 'ACTIVE'
          AND ta.location_code = :locationCode
          AND DATE(ta.adjustment_date) BETWEEN :fromDate AND :toDate
          AND (
              ta.external_id = :vendorId
              OR ta.external_id IN (
                  SELECT creditlist_id 
                  FROM m_credit_list 
                  WHERE recon_group_id = (
                      SELECT recon_group_id 
                      FROM m_credit_list 
                      WHERE creditlist_id = :vendorId
                  )
                  AND recon_group_id IS NOT NULL
              )
          )


        ORDER BY sort_date, entry_type DESC, bill_no`,
        {
            replacements: { 
                locationCode,
                vendorId,
                fromDate,
                toDate
            },
            type: db.Sequelize.QueryTypes.SELECT
        }
    );
    return result;
},

    getLocationDetails: (location_code) => {
        return db.sequelize.query(
            `SELECT location_name, address,location_id,location_code
             FROM m_location 
             WHERE location_code = :location_code`,
            {
                replacements: { location_code: location_code },
                type: Sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            if (results.length > 0) {
                return results[0];
            } else {
                throw new Error("Location not found");
            }
        });
    },
  
    getSales: async (locationCode, reportFromDate, reportToDate) => {
        try {
          // Log the start of the overall function.
          console.log(
            `getSales started for location: ${locationCode}, from: ${reportFromDate}, to: ${reportToDate}`
          );
          console.time('Total Execution Time');
      
          // Log the start of fetching distinct product codes.
          console.time('Fetch Product Codes Time');
          const productCodes = await db.sequelize.query(
            `SELECT DISTINCT product_code FROM m_pump WHERE location_code = :locationCode`,
            {
              replacements: { locationCode },
              type: Sequelize.QueryTypes.SELECT,
            }
          );
          console.timeEnd('Fetch Product Codes Time');
      
          // Build dynamic CASE statements for each product code.
          const caseStatements = productCodes
            .map(
              (product) => `
                SUM(CASE 
                    WHEN mp.product_code = '${product.product_code}' 
                    THEN ROUND(tr.closing_reading - tr.opening_reading - tr.testing)
                    ELSE 0 
                END) AS \`${product.product_code}\`
              `
            )
            .join(', ');
      
          // Construct the query using a CTE to pre-aggregate loose sales.
          // The `loose` value is wrapped in MAX() in the outer query to satisfy ONLY_FULL_GROUP_BY.
          const query = `
            WITH loose_sales AS (
              SELECT 
                DATE(tcoil.closing_date) AS closing_date,
                SUM(toil.given_qty - toil.returned_qty) AS loose
              FROM t_2toil toil
              JOIN t_closing tcoil ON tcoil.closing_id = toil.closing_id
              JOIN m_product mp ON toil.product_id = mp.product_id
              WHERE tcoil.location_code = :locationCode
                AND UPPER(mp.product_name) = '2T LOOSE'
              GROUP BY DATE(tcoil.closing_date)
            )
            SELECT
              DATE_FORMAT(tc.closing_date, '%d-%b-%Y') AS closing_date_formatted,
              MAX(IFNULL(ls.loose, 0)) AS loose,
              ${caseStatements}
            FROM t_closing tc
            JOIN t_reading tr ON tc.closing_id = tr.closing_id
            JOIN m_pump mp ON tr.pump_id = mp.pump_id
            LEFT JOIN loose_sales ls ON DATE(tc.closing_date) = ls.closing_date
            WHERE 
              tc.closing_status = 'CLOSED'
              AND date(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
              AND tc.location_code = :locationCode
            GROUP BY tc.closing_date
            ORDER BY tc.closing_date ASC
          `;
      
          // Log the start of the query execution.
          console.time('Query Execution Time');
          const result = await db.sequelize.query(query, {
            replacements: { locationCode, reportFromDate, reportToDate },
            type: Sequelize.QueryTypes.SELECT,
          });
          // Log when the query has finished.
          console.timeEnd('Query Execution Time');
      
          console.timeEnd('Total Execution Time');
          console.log('getSales completed successfully.');
      
          return result;
        } catch (error) {
          console.error('Error in getSales:', error);
          throw error;
        }
      },
    getMonthlySales: async (locationCode, reportFromDate, reportToDate) => {
    try {
        console.log(
            `getMonthlySales started for location: ${locationCode}, from: ${reportFromDate}, to: ${reportToDate}`
        );
        console.time('Total Monthly Sales Execution Time');
    
        // Fetch distinct product codes
        console.time('Fetch Product Codes Time');
        const productCodes = await db.sequelize.query(
            `SELECT DISTINCT product_code FROM m_pump WHERE location_code = :locationCode`,
            {
                replacements: { locationCode },
                type: Sequelize.QueryTypes.SELECT,
            }
        );
        console.timeEnd('Fetch Product Codes Time');
    
        // Build dynamic CASE statements for each product code
        const caseStatements = productCodes
            .map(
                (product) => `
                    SUM(CASE 
                        WHEN mp.product_code = '${product.product_code}' 
                        THEN ROUND(tr.closing_reading - tr.opening_reading - tr.testing)
                        ELSE 0 
                    END) AS \`${product.product_code}\`
                `
            )
            .join(', ');
    
        // Construct the query with monthly grouping
        const query = `
            WITH loose_sales AS (
                SELECT 
                    DATE_FORMAT(tcoil.closing_date, '%Y-%m') AS month_key,
                    SUM(toil.given_qty - toil.returned_qty) AS loose
                FROM t_2toil toil
                JOIN t_closing tcoil ON tcoil.closing_id = toil.closing_id
                JOIN m_product mp ON toil.product_id = mp.product_id
                WHERE tcoil.location_code = :locationCode
                    AND UPPER(mp.product_name) = '2T LOOSE'
                GROUP BY DATE_FORMAT(tcoil.closing_date, '%Y-%m')
            )
            SELECT
                DATE_FORMAT(tc.closing_date, '%b-%Y') AS month_formatted,
                DATE_FORMAT(tc.closing_date, '%Y-%m') AS month_key,
                MAX(IFNULL(ls.loose, 0)) AS loose,
                ${caseStatements}
            FROM t_closing tc
            JOIN t_reading tr ON tc.closing_id = tr.closing_id
            JOIN m_pump mp ON tr.pump_id = mp.pump_id
            LEFT JOIN loose_sales ls ON DATE_FORMAT(tc.closing_date, '%Y-%m') = ls.month_key
            WHERE 
                tc.closing_status = 'CLOSED'
                AND DATE(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
                AND tc.location_code = :locationCode
            GROUP BY DATE_FORMAT(tc.closing_date, '%Y-%m')
            ORDER BY month_key ASC
        `;
    
        console.time('Monthly Query Execution Time');
        const result = await db.sequelize.query(query, {
            replacements: { locationCode, reportFromDate, reportToDate },
            type: Sequelize.QueryTypes.SELECT,
        });
        console.timeEnd('Monthly Query Execution Time');
    
        console.timeEnd('Total Monthly Sales Execution Time');
        console.log('getMonthlySales completed successfully.');
    
        return result;
    } catch (error) {
        console.error('Error in getMonthlySales:', error);
        throw error;
    }
},    
      
updateReconMatch: async ({ tableName, recordId, matchId, user }) => {
    return db.sequelize.query(
        `
        UPDATE ${tableName}
        SET 
            recon_match_id = :matchId,
            manual_recon_flag = 1,
            manual_recon_by = :user,
            manual_recon_date = NOW()
        WHERE ${tableName.endsWith('t_receipts') ? 'treceipt_id' :
               tableName.endsWith('t_digital_sales') ? 'digital_sales_id' :
               tableName.endsWith('t_bank_transaction') ? 't_bank_id' :
               tableName.endsWith('t_adjustments') ? 'adjustment_id' :
               tableName.endsWith('t_cashflow_transaction') ? 'transaction_id' :
               'id'} = :recordId
        `,
        {
            replacements: { matchId, user, recordId },
            type: db.Sequelize.QueryTypes.UPDATE
        }
    );
},
// Supplier Statement Methods (using stored procedures)
getSupplierBalance: (supplierId, closingQueryFromDate, closingQueryToDate) => {
    return db.sequelize.query(
        `SELECT 
            get_opening_supplier_balance(:supplierId, :fromDate) as OpeningData,
            get_closing_supplier_balance(:supplierId, :toDate) as ClosingData`,
        {
            replacements: { 
                supplierId: supplierId,
                fromDate: closingQueryFromDate,
                toDate: closingQueryToDate
            },
            type: Sequelize.QueryTypes.SELECT
        }
    );
},

getSupplierStmt: (locationCode, closingQueryFromDate, closingQueryToDate, supplierId) => {
    return db.sequelize.query(
        `-- Invoices (Debit)
        SELECT 
            tlh.invoice_date AS tran_date,
            tlh.invoice_number AS bill_no,
            ms.supplier_name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            tlh.invoice_amount AS amount,
            tlh.notes,
            'INVOICE' AS transaction_type
        FROM t_lubes_inv_hdr tlh
        JOIN m_supplier ms ON tlh.supplier_id = ms.supplier_id
        WHERE tlh.location_code = :locationCode
          AND tlh.supplier_id = :supplierId
          AND tlh.closing_status = 'CLOSED'
          AND DATE(tlh.invoice_date) BETWEEN :fromDate AND :toDate

        UNION ALL

        -- Payments (Credit)
        SELECT 
            tbt.trans_date AS tran_date,
            CONCAT('Payment Ref: ', COALESCE(tbt.remarks, tbt.t_bank_id)) AS bill_no,
            ms.supplier_name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            tbt.debit_amount AS amount,
            tbt.remarks AS notes,
            'PAYMENT' AS transaction_type
        FROM t_bank_transaction tbt
        JOIN m_supplier ms ON tbt.external_id = ms.supplier_id
        WHERE tbt.external_source = 'Supplier'
          AND tbt.external_id = :supplierId
          AND DATE(tbt.trans_date) BETWEEN :fromDate AND :toDate
          AND tbt.debit_amount > 0

        UNION ALL

        -- Refunds from Supplier (Debit - rare)
        SELECT 
            tbt.trans_date AS tran_date,
            CONCAT('Refund Ref: ', COALESCE(tbt.remarks, tbt.t_bank_id)) AS bill_no,
            ms.supplier_name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            tbt.credit_amount AS amount,
            tbt.remarks AS notes,
            'REFUND' AS transaction_type
        FROM t_bank_transaction tbt
        JOIN m_supplier ms ON tbt.external_id = ms.supplier_id
        WHERE tbt.external_source = 'Supplier'
          AND tbt.external_id = :supplierId
          AND DATE(tbt.trans_date) BETWEEN :fromDate AND :toDate
          AND tbt.credit_amount > 0

        UNION ALL

        -- Adjustment Debits
        SELECT 
            ta.adjustment_date AS tran_date,
            ta.reference_no AS bill_no,
            ms.supplier_name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            ta.debit_amount AS amount,
            ta.description AS notes,
            'ADJUSTMENT_DEBIT' AS transaction_type
        FROM t_adjustments ta
        JOIN m_supplier ms ON ta.external_id = ms.supplier_id
        WHERE ta.external_source = 'Supplier'
          AND ta.external_id = :supplierId
          AND ta.status = 'ACTIVE'
          AND DATE(ta.adjustment_date) BETWEEN :fromDate AND :toDate
          AND ta.debit_amount > 0

        UNION ALL

        -- Adjustment Credits
        SELECT 
            ta.adjustment_date AS tran_date,
            ta.reference_no AS bill_no,
            ms.supplier_name AS company_name,
            NULL AS product_name,
            NULL AS price,
            NULL AS price_discount,
            NULL AS qty,
            ta.credit_amount AS amount,
            ta.description AS notes,
            'ADJUSTMENT_CREDIT' AS transaction_type
        FROM t_adjustments ta
        JOIN m_supplier ms ON ta.external_id = ms.supplier_id
        WHERE ta.external_source = 'Supplier'
          AND ta.external_id = :supplierId
          AND ta.status = 'ACTIVE'
          AND DATE(ta.adjustment_date) BETWEEN :fromDate AND :toDate
          AND ta.credit_amount > 0

        ORDER BY tran_date, transaction_type`,
        {
            replacements: { 
                locationCode: locationCode,
                supplierId: supplierId,
                fromDate: closingQueryFromDate,
                toDate: closingQueryToDate
            },
            type: Sequelize.QueryTypes.SELECT
        }
    );
},

// Get earliest opening balance date for a supplier
getSupplierOpeningBalanceDate: (supplierId) => {
    return db.sequelize.query(
        `SELECT MIN(balance_date) as earliest_opening_date
         FROM r_supplier_open_bal
         WHERE supplier_id = :supplierId`,
        {
            replacements: { supplierId: supplierId },
            type: Sequelize.QueryTypes.SELECT
        }
    );
}
      
}