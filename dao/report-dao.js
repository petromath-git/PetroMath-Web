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
    getDayBalance: (locationCode,closingQueryToDate) => {             
        return db.sequelize.query(
            `select upper(mcl.company_name) company_name,get_closing_credit_balance(mcl.creditlist_id,:closing_date) as ClosingData
             from m_credit_list mcl where location_code = :locationCode
             and  COALESCE(mcl.card_flag,'N') <> 'Y' order by 2 desc `,
            {   replacements: { locationCode: locationCode,closing_date: closingQueryToDate}, 
                 type: Sequelize.QueryTypes.SELECT }           
        );
        
    }    ,   
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
        WHERE ta.external_source = 'CREDIT'
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


    getDigitalStmt: async (locationCode, fromDate, toDate, vendorId) => {
    const result = await db.sequelize.query(
        `SELECT 
                  DATE_FORMAT(tds.transaction_date, '%d-%m-%Y') as tran_date,
                  CONCAT('DS-', tds.digital_sales_id) as bill_no,
                  tds.notes,
                  mcl.company_name,
                  'Digital Sale' as product_name,
                  tds.amount,
                  tds.transaction_date as sort_date
              FROM t_digital_sales tds
              INNER JOIN t_closing tc ON tds.closing_id = tc.closing_id
              INNER JOIN m_credit_list mcl ON tds.vendor_id = mcl.creditlist_id
              WHERE tc.location_code = :locationCode
                AND DATE(tc.closing_date) BETWEEN :fromDate AND :toDate
                AND tds.vendor_id = :vendorId

              UNION ALL

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
                  'Digital Receipt' as product_name,
                  tr.amount,
                  tr.receipt_date as sort_date
              FROM t_receipts tr
              INNER JOIN m_credit_list mcl ON tr.digital_creditlist_id = mcl.creditlist_id
              INNER JOIN m_credit_list mcl_payer ON tr.creditlist_id = mcl_payer.creditlist_id
              WHERE tr.location_code = :locationCode
                AND DATE(tr.receipt_date) BETWEEN :fromDate AND :toDate
                AND tr.digital_creditlist_id = :vendorId
                AND tr.receipt_type = 'Digital'

              UNION ALL

              SELECT 
                  DATE_FORMAT(tr.receipt_date, '%d-%m-%Y') as tran_date,
                  tr.receipt_no as bill_no,
                  tr.notes,
                  mcl.company_name,
                  NULL as product_name,
                  tr.amount,
                  tr.receipt_date as sort_date
              FROM t_receipts tr
              INNER JOIN m_credit_list mcl ON tr.creditlist_id = mcl.creditlist_id
              WHERE tr.location_code = :locationCode
                AND DATE(tr.receipt_date) BETWEEN :fromDate AND :toDate
                AND tr.creditlist_id = :vendorId
                AND mcl.card_flag = 'Y'

              ORDER BY sort_date, bill_no`,
        {
            replacements: { 
                locationCode: locationCode, 
                fromDate: fromDate, 
                toDate: toDate, 
                vendorId: vendorId 
            },
            type: db.sequelize.QueryTypes.SELECT
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
    // getSales: async (locationCode,reportFromDate,reportToDate) => {
    
            
    
    //         const productCodes = await db.sequelize.query(
    //             `SELECT DISTINCT product_code FROM m_pump where location_code = :locationCode`,
    //                 {
    //                 replacements: {locationCode: locationCode}, 
    //                 type: Sequelize.QueryTypes.SELECT
    //                 }
    //           );
    
    //           const caseStatements = productCodes.map(
    //             (product) => `
    //               SUM(CASE 
    //                 WHEN mp.product_code = '${product.product_code}' 
    //                 THEN round((tr.closing_reading - tr.opening_reading - tr.testing))
    //                 ELSE 0 
    //               END) AS '${product.product_code}'`
    //           ).join(', ');
    
    
            
    //         const query = `
    //         SELECT                                      
    //           DATE_FORMAT(tc.closing_date, '%d-%b-%Y') AS closing_date_formatted,              
    //            (select sum(given_qty-returned_qty) from t_2toil toil,m_product mp,t_closing tcoil
    //           where toil.product_id = mp.product_id
    //           and DATE(tcoil.closing_date) =  DATE(tc.closing_date)
    //           and tcoil.closing_id = toil.closing_id
    //           and tcoil.location_code = :locationCode
    //           and upper(mp.product_name) = '2T LOOSE' ) loose,
    //           ${caseStatements}
    //         FROM 
    //           t_closing tc
    //         JOIN 
    //           t_reading tr ON tc.closing_id = tr.closing_id
    //         JOIN 
    //           m_pump mp ON tr.pump_id = mp.pump_id
    //         WHERE 
    //           tc.closing_status = 'CLOSED'
    //           AND DATE(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
    //           AND tc.location_code = :locationCode
    //         GROUP BY 
    //          tc.closing_date`;
          
    //       // Execute the query
    //       const result = await db.sequelize.query(query,  {
    //         replacements: {locationCode: locationCode,reportFromDate: reportFromDate ,reportToDate: reportToDate}, 
    //         type: Sequelize.QueryTypes.SELECT
    //         });
                
                
    //             return result;
            
    //     },

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
      
      
}