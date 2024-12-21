const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {


   
    getclosingid: async (locationCode, reportDate) =>{
    const result = await db.sequelize.query(`SELECT closing_id
                                                FROM   t_closing tc
                                                WHERE  tc.location_code = :locationCode
                                                    AND Date(tc.closing_date) = :reportDate`,                                                   
                                                    {
                                                        replacements: { locationCode: locationCode, reportDate: reportDate },
                                                        type: Sequelize.QueryTypes.SELECT
                                                      }

       );
       return result;

   },

   getreadings: async (locationCode, reportDate) => {
    const data = await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);
    
    
    const result = await db.sequelize.query(
        `SELECT mp.pump_code,
       Round(Max(tr.closing_reading))                           closing,
       Round(Min(tr.opening_reading))                           opening,
       Round(Max(tr.closing_reading) - Min(tr.opening_reading)) sale,
       mp.pump_id,
       Sum(tr.testing) testing
       FROM   t_reading tr,
       m_pump mp
       WHERE  tr.closing_id IN (:closing_id)
       AND tr.pump_id = mp.pump_id
       GROUP  BY mp.pump_code,mp.pump_id
       ORDER  BY mp.pump_code `,
        {
          replacements: { closing_id: closing_id}, 
          type: Sequelize.QueryTypes.SELECT
        }

    
      );
         
      return result;

   },

   getsalessummary: async (locationCode, reportDate) => {
    const data =  await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);
    
    
    const result = await db.sequelize.query(
        `select a.product_code,
               COALESCE(round(sum(a.sales),2),0) nozzle_sales,
               COALESCE(c.test_qty,0) nozzle_test,
               COALESCE(round(sum(a.sales)-c.test_qty,2),0) total_sales,
               COALESCE(round(cr_qty,2),0) credit_sales
                from
                                        (select mp.pump_code,
                                        mp.product_code,
                                        max(tr.closing_reading),
                                        min(tr.opening_reading),
                                        max(tr.closing_reading)-min(tr.opening_reading) sales
                                        from t_reading tr,m_pump mp 
                                        where tr.closing_id in (:closing_id) and   tr.pump_id = mp.pump_id 
                                        group by  mp.pump_code,mp.product_code) a lEFT OUTER JOIN
                                        (select sum(tcr.qty) cr_qty,mp.product_name from t_credits tcr,m_product mp where 1=1
                                        and  tcr.product_id = mp.product_id
                                        and  tcr.closing_id in (:closing_id) group by mp.product_name)b 
                                        ON a.product_code = b.product_name
                                        lEFT OUTER JOIN
                                        (select mp.product_code,sum(tr.testing) test_qty from t_reading tr,m_pump mp 
                                          where tr.pump_id = mp.pump_id
                                          and   tr.closing_id in (:closing_id)
                                          group by mp.product_code)c 
                                          ON a.product_code = c.product_code 
                                        group by a.product_code`,
        {
          replacements: { closing_id: closing_id}, 
          type: Sequelize.QueryTypes.SELECT
        }

    
      );
      
      
      return result;

   },
   getcollection: async (locationCode, reportDate) => {
    const data =  await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);
    
   const result = await db.sequelize.query(
    `select product_code,
                                                sum(round(total_amt,2))totalsalamt,
                                               COALESCE((
                                                    SELECT SUM(ROUND(amount, 2)) 
                                                    FROM t_credits tcr
                                                    JOIN m_product mp ON tcr.product_id = mp.product_id
                                                    WHERE tcr.closing_id IN (:closing_id)
                                                    AND mp.product_name = a.product_code
                                                    GROUP BY mp.product_name
                                                ), 0) AS crsaleamt,
                                                COALESCE((
                                                    SELECT SUM(ROUND(tcr.qty * tcr.price, 2)) 
                                                    FROM t_credits tcr
                                                    JOIN m_product mp ON tcr.product_id = mp.product_id
                                                    WHERE tcr.closing_id IN (:closing_id)
                                                    AND mp.product_name = a.product_code
                                                    GROUP BY mp.product_name
                                                ), 0) AS crsaleamtwithoutdisc
                                         from
                                          (select mp.pump_code,
                                                mp.product_code ,
                                               sum( (tr.closing_reading - tr.opening_reading - tr.testing)*price) total_amt
                                                from t_reading tr,m_pump mp
                                                 where 1=1
                                                 and   tr.pump_id = mp.pump_id 
												 and   tr.closing_id in (:closing_id)
                                                 group by  mp.pump_code,mp.product_code) a 
                                         group by product_code`,
    {
      replacements: { closing_id: closing_id}, 
      type: Sequelize.QueryTypes.SELECT
    }


    );
    
    
    return result;

    },
    getOilcollection: async (locationCode, reportDate) => {
      const data =  await module.exports.getclosingid(locationCode,reportDate);
      const closing_id = data.map(item => item.closing_id);
      
     const result = await db.sequelize.query(
                          `SELECT 
                        ROUND(SUM(a.cash_amt), 2) AS oil_cash,
                        ROUND(SUM(a.credit_amt), 2) AS oil_credit
                        FROM
                        (
                            -- Subquery 1: Calculate cash_amt for 'DSR - OIL'
                            SELECT 
                                (tc.given_qty - tc.returned_qty) * mp.price AS cash_amt,
                                0 AS credit_amt
                            FROM
                                t_2toil tc
                            JOIN
                                m_product mp ON mp.product_name = 'DSR - OIL' 
                                AND mp.location_code = 'MC2'
                            WHERE
                                tc.closing_id in (:closing_id)

                            UNION ALL
                            -- Subquery 2: Calculate cash_amt for '2T POUCH'
                            SELECT 
                                (tc.given_qty - tc.returned_qty) * mp.price AS cash_amt,
                                0 AS credit_amt
                            FROM
                                t_2toil tc
                            JOIN
                                m_product mp ON tc.product_id = mp.product_id
                            WHERE
                                UPPER(mp.product_name) = '2T POUCH' 
                                AND tc.closing_id in (:closing_id)
                            UNION ALL
                            -- Subquery 3: Calculate cash_amt from t_cashsales
                            SELECT 
                                tc.amount AS cash_amt,
                                0 AS credit_amt
                            FROM
                                t_cashsales tc
                            JOIN
                                m_product mp ON tc.product_id = mp.product_id
                            WHERE
                                NOT EXISTS (
                                    SELECT 1
                                    FROM t_reading tr
                                    JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
                                    WHERE tr.closing_id in (:closing_id)
                                      AND mp2.product_code = mp.product_name
                                )
                                AND tc.closing_id in (:closing_id)
                            UNION ALL
                            -- Subquery 4: Calculate credit_amt from t_credits
                            SELECT 
                                0 AS cash_amt,
                                tc.amount AS credit_amt
                            FROM
                                t_credits tc
                            JOIN
                                m_product mp ON tc.product_id = mp.product_id
                            WHERE
                                NOT EXISTS (
                                    SELECT 1
                                    FROM t_reading tr
                                    JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
                                    WHERE tr.closing_id in (:closing_id)
                                      AND mp2.product_code = mp.product_name
                                )
                                AND tc.closing_id in (:closing_id)
                        ) a`,
      {
        replacements: { closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
      }
  
  
      );
      
      
      return result;
  
    },
    getcreditsales: async (locationCode, reportDate) => {
        const data =  await module.exports.getclosingid(locationCode,reportDate);
        const closing_id = data.map(item => item.closing_id);
        
    const result = await db.sequelize.query(
        `select tc.bill_no,COALESCE (mcl.short_name,mcl.company_name) name,mp.product_name,tc.price,tc.qty,round(tc.amount,2) amt
                                                from t_credits tc,m_credit_list mcl,m_product mp 
                                                where tc.creditlist_id = mcl.creditlist_id
                                                and   tc.product_id = mp.product_id
                                                and   ifnull(mcl.card_flag,'N') != 'Y'
                                                and   tc.closing_id in (:closing_id)
                                                order by tc.bill_no`,
        {
        replacements: { closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        }


    );
    
    
    return result;

    },
    getcardsales: async (locationCode, reportDate) => {
        const data =  await module.exports.getclosingid(locationCode,reportDate);
        const closing_id = data.map(item => item.closing_id);
        
    const result = await db.sequelize.query(
        `select tc.bill_no,COALESCE (mcl.short_name,mcl.company_name) name,mp.product_name,tc.price,tc.qty,round(tc.amount,2) amt
                                              from t_credits tc,m_credit_list mcl,m_product mp 
                                              where tc.creditlist_id = mcl.creditlist_id
                                              and   tc.product_id = mp.product_id
											  and   mcl.card_flag = 'Y'
                                              and   tc.closing_id in (:closing_id)
                                              order by tc.bill_no`,
        {
        replacements: { closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        }


    );
    
    
    return result;

    },
    getexpenses: async (locationCode, reportDate) => {
        const data =  await module.exports.getclosingid(locationCode,reportDate);
        const closing_id = data.map(item => item.closing_id);
        
    const result = await db.sequelize.query(
        `select me.expense_name,round(sum(te.amount),2) amount ,
                                        te.notes from t_expense te,m_expense me 
                                        where me.expense_id = te.expense_id
                                        and te.closing_id in (:closing_id)
                                          group by me.expense_name,te.notes
                                        order by notes`,
        {
        replacements: { closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        }


    );
    
    
    return result;

    },
    getstockreceipt: async (locationCode, reportDate) => {
        
        const result = await db.sequelize.query(
            `select tr.fomratted_decant_date decant_date,tr.decant_time,
                                                tr.truck_number,tr.odometer_reading,tr.driver,tr.helper,tr.decant_incharge,
                                                CONCAT(coalesce(tr.MS,0),'+',coalesce(tr.HSD,0),'+',coalesce(tr.XMS,0),'+',coalesce(tr.GD,0),'+',coalesce(tr.E20,0)) product
                                                ,tr.invoice_number,tr.amount invoice_amount
                                                from t_tank_receipt_v tr,t_tank_stk_rcpt tts 
                                                where 1=1
                                                and tr.location_code = :location_code
                                                and tr.ttank_id = tts.ttank_id
                                                and  DATE(tts.cashflow_date) = :cashflow_date`,
            {
            replacements: {location_code:locationCode,cashflow_date: reportDate}, 
            type: Sequelize.QueryTypes.SELECT
            }


        );
        
        
        return result;

    },     
    getcreditreceipt: async (locationCode, reportDate) => {
        
        const result = await db.sequelize.query(
                                    `select tr.receipt_no,
                                            date_format(tr.receipt_date,'%d-%m-%Y') receipt_date,
                                            COALESCE (mcl.short_name,mcl.company_name) name,
                                            tr.receipt_type,
                                            tr.amount,tr.notes
                                            from t_receipts tr,m_credit_list mcl 
                                            where 1=1
                                            and tr.creditlist_id = mcl.creditlist_id
                                            and tr.location_code = :location_code
                                            and   DATE(tr.cashflow_date) = :cashflow_date`,
            {
            replacements: {location_code:locationCode,cashflow_date: reportDate}, 
            type: Sequelize.QueryTypes.SELECT
            }
    
    
        );
        
        
        return result;
    
    },
    getshiftsummary: async (locationCode, reportDate) => {

        const data =  await module.exports.getclosingid(locationCode,reportDate);
        const closing_id = data.map(item => item.closing_id);

        const productCodes = await db.sequelize.query(
            `SELECT DISTINCT product_code FROM m_pump where location_code = :locationCode`,
                {
                replacements: {locationCode: locationCode}, 
                type: Sequelize.QueryTypes.SELECT
                }
          );

          const caseStatements = productCodes.map(
            (product) => `
              SUM(CASE 
                WHEN mp.product_code = '${product.product_code}' 
                THEN (tr.closing_reading - tr.opening_reading - tr.testing) 
                ELSE 0 
              END) AS '${product.product_code}'`
          ).join(', ');


        
        const query = `
        SELECT                    
          mper.Person_Name AS person_name,        
          DATE_FORMAT(tc.closing_date, '%d-%b-%Y') AS closing_date_formatted,
          CALCULATE_EXSHORTAGE(tc.closing_id) AS ex_short,
          ${caseStatements}
        FROM 
          t_closing tc
        JOIN 
          m_persons mper ON mper.Person_id = tc.cashier_id
        JOIN 
          t_reading tr ON tc.closing_id = tr.closing_id
        JOIN 
          m_pump mp ON tr.pump_id = mp.pump_id
        WHERE 
          tc.closing_status = 'CLOSED'
          AND tc.closing_id IN (:closing_id)
        GROUP BY 
          tc.closing_id, tc.location_code, mper.Person_Name, mper.Person_id, mper.Role, tc.closing_date`;
      
      // Execute the query
      const result = await db.sequelize.query(query,  {
        replacements: {closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        });
            
            
            return result;
        
    }      


}

