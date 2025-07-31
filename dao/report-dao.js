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
    getCreditStmt: (locationCode, closingQueryFromDate, closingQueryToDate,creditId) => {
        if(creditId==-1){               
            return TxnCreditStmtViews.findAll({
                where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            });
        }
        else{
            return TxnCreditStmtViews.findAll({
                where: { [Op.and]: [
                    { location_code: locationCode },
                    { creditlist_id: creditId},
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            });

        }
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