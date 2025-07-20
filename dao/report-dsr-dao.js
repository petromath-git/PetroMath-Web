const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {


    getDayClose: async (locationCode, reportDate) =>{
        const result = await db.sequelize.query(`SELECT cashflow_id
                                                    FROM   t_cashflow_closing tc
                                                    WHERE  tc.location_code = :locationCode
                                                        AND Date(tc.cashflow_date) = :reportDate
                                                        AND closing_status = 'CLOSED' `,                                                   
                                                        {
                                                            replacements: { locationCode: locationCode, reportDate: reportDate },
                                                            type: Sequelize.QueryTypes.SELECT
                                                          }
    
           );
           return result;
    
       },

    getclosingid: async (locationCode, reportDate) =>{
    const result = await db.sequelize.query(`SELECT closing_id
                                                FROM   t_closing tc
                                                WHERE  tc.location_code = :locationCode
                                                    AND cashflow_id in (SELECT cashflow_id
                                                    FROM   t_cashflow_closing tc
                                                    WHERE  tc.location_code = :locationCode
                                                        AND Date(tc.cashflow_date) = :reportDate
                                                        AND closing_status = 'CLOSED')`,                                                   
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
       Round(Sum(tr.testing)) testing
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
   getPumpPrice: async (locationCode, reportDate) => {

    const data = await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);

    const result = await db.sequelize.query(`
        SELECT DISTINCT mp.product_code, tr.price
        FROM t_reading tr
        JOIN m_pump mp ON tr.pump_id = mp.pump_id
        JOIN t_closing tc ON tr.closing_id = tc.closing_id
        WHERE mp.location_code = tc.location_code
        AND tc.closing_id IN (:closingIds)
        ORDER BY mp.product_code
    `, {
        replacements: { closingIds: closing_id },
        type: Sequelize.QueryTypes.SELECT
    });
    return result;
},

getMonthlyOfftake: async (locationCode, reportDate) => {
    const result = await db.sequelize.query(`
        SELECT mt.product_code,
               COALESCE(SUM(CASE WHEN ( YEAR(rcpt.decant_date) = YEAR(:closeDate) AND MONTH(rcpt.decant_date) = MONTH(:closeDate) )THEN dtl.quantity ELSE 0 END), 0) AS current_month_Offtake,               
               COALESCE(SUM(CASE WHEN (YEAR(rcpt.decant_date) = YEAR(DATE_SUB(:closeDate, INTERVAL 1 MONTH))                
                   AND MONTH(rcpt.decant_date) = MONTH(DATE_SUB(:closeDate, INTERVAL 1 MONTH))) THEN dtl.quantity ELSE 0 END), 0) AS last_month_Offtake,
                   COALESCE(SUM(CASE WHEN ( YEAR(rcpt.decant_date) = YEAR(:closeDate)-1 AND MONTH(rcpt.decant_date) = MONTH(:closeDate) ) THEN dtl.quantity ELSE 0 END), 0) AS last_year_Offtake
        FROM t_tank_stk_rcpt rcpt
        JOIN t_tank_stk_rcpt_dtl dtl ON rcpt.ttank_id = dtl.ttank_id
        JOIN m_tank mt ON dtl.tank_id = mt.tank_id
        WHERE rcpt.location_code = :location        
       -- AND DAY(rcpt.decant_date) <= DAY(:closeDate)
        GROUP BY mt.product_code
    `, {
        replacements: { location: locationCode, closeDate: reportDate },
        type: Sequelize.QueryTypes.SELECT
    });
    return result;
},


getDeadline: async (locationCode, reportDate) => {
    const result = await db.sequelize.query(`
        select tv.deadline_date,DAYNAME(td.deadline_date) day,tv.message
                                          from t_deadline_v tv,t_deadline td
                                         where tv.display_warning = 'Y' AND td.t_deadline_id = tv.t_deadline_id 
                                              and tv.location_code = :location
    `, {
        replacements: { location: locationCode, closeDate: reportDate },
        type: Sequelize.QueryTypes.SELECT
    });
    return result;
},




   getsalessummary: async (locationCode, reportDate) => {
    const data =  await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);
    
    
    const result = await db.sequelize.query(
        `select a.product_code,
               count(distinct a.pump_code) as nozzle_count, 
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
                                        (select sum(tcr.qty) cr_qty,mp.product_name from t_credits tcr,m_product mp,m_credit_list mcl where 1=1
                                        and  tcr.product_id = mp.product_id
                                        and  tcr.creditlist_id = mcl.creditlist_id
                                        and  COALESCE(mcl.card_flag,'N') = 'N'
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
                                                    JOIN m_credit_list mcl ON tcr.creditlist_id = mcl.creditlist_id
                                                    WHERE tcr.closing_id IN (:closing_id)
                                                    AND mp.product_name = a.product_code
                                                    AND COALESCE(mcl.card_flag,'N') != 'Y'
                                                    GROUP BY mp.product_name
                                                ), 0) AS crsaleamt,
                                                COALESCE((
                                                    SELECT SUM(ROUND(tcr.qty * tcr.price, 2)) 
                                                    FROM t_credits tcr
                                                    JOIN m_product mp ON tcr.product_id = mp.product_id
                                                    JOIN m_credit_list mcl ON tcr.creditlist_id = mcl.creditlist_id
                                                    WHERE tcr.closing_id IN (:closing_id)
                                                    AND mp.product_name = a.product_code
                                                    AND COALESCE(mcl.card_flag,'N') != 'Y'
                                                    GROUP BY mp.product_name
                                                ), 0) AS crsaleamtwithoutdisc,
                                                 COALESCE((
                                                    SELECT SUM(ROUND(tcr.qty * tcr.price, 2)) 
                                                    FROM t_credits tcr
                                                    JOIN m_product mp ON tcr.product_id = mp.product_id
                                                    JOIN m_credit_list mcl ON tcr.creditlist_id = mcl.creditlist_id
                                                    WHERE tcr.closing_id IN (:closing_id)
                                                    AND mp.product_name = a.product_code
                                                    AND COALESCE(mcl.card_flag,'N') = 'Y'
                                                    GROUP BY mp.product_name
                                                ), 0) AS cardsales
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
                        (                            -- Subquery 1: Calculate cash_amt for 'DSR - OIL'
                            SELECT 
                                (tc.given_qty - tc.returned_qty) * (select price from m_product where product_name = 'DSR - OIL' and location_code = mp.location_code)                                
                                AS cash_amt,
                                0 AS credit_amt
                            FROM  t_2toil tc,m_product mp 
                            WHERE tc.closing_id in (:closing_id)
                            AND mp.product_id = tc.product_id
                            AND UPPER(mp.product_name) = '2T LOOSE'
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
        `select tc.bill_no,COALESCE (mcl.short_name,mcl.company_name) name,mp.product_name,tc.price,tc.qty,round((tc.price_discount*tc.qty),2) discount,round(tc.amount,2) amt
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
											                        and   COALESCE(mcl.card_flag,'N') = 'Y'
                                              and   tc.closing_id in (:closing_id)
                                              order by tc.bill_no`,
        {
        replacements: { closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        }


    );
    
    
    return result;

    },
    getcardsalesSummary: async (locationCode, reportDate) => {
      const data =  await module.exports.getclosingid(locationCode,reportDate);
      const closing_id = data.map(item => item.closing_id);
      
  const result = await db.sequelize.query(
      `select tc.creditlist_id,COALESCE (mcl.short_name,mcl.company_name) name,round(sum(tc.amount),2) amt
                                            from t_credits tc,m_credit_list mcl 
                                            where tc.creditlist_id = mcl.creditlist_id                                           
                                            and   mcl.card_flag = 'Y'
                                            and   tc.closing_id in (:closing_id)
                                            group by tc.creditlist_id,COALESCE (mcl.short_name,mcl.company_name)`,
      {
      replacements: { closing_id: closing_id}, 
      type: Sequelize.QueryTypes.SELECT
      }


  );
  
  
  return result;

  },
  getCashsales: async (locationCode, reportDate) => {
    const data =  await module.exports.getclosingid(locationCode,reportDate);
    const closing_id = data.map(item => item.closing_id);
    
const result = await db.sequelize.query(
    `select mp.product_name,sum(tc.qty) qty,tc.price,tc.qty*tc.price_discount discount,sum(amount) amt
                                              from t_cashsales tc,m_product mp 
                                              where 1=1
                                              and   tc.product_id = mp.product_id
                                              and   tc.closing_id in (:closing_id)
                                              group by mp.product_name,tc.price,discount
                                              union all
                                              select mp.product_name product_name,sum((given_qty-returned_qty)) qty,(select price from m_product where product_name = 'DSR - OIL' and location_code = mp.location_code ) price,0,sum((given_qty-returned_qty)*(select price from m_product where product_name = 'DSR - OIL' and location_code = mp.location_code )) amt 
                                             from t_2toil tc,
                                                  m_product mp
                                            where tc.product_id = mp.product_id
                                            and upper(mp.product_name) = '2T LOOSE'
                                            and tc.closing_id in (:closing_id)
                                            group by mp.product_name,price
                                            union all
                                            select mp.product_name product_name,sum((given_qty-returned_qty)) qty,mp.price,0,sum((given_qty-returned_qty)*mp.price) amt 
                                               from t_2toil tc,
                                                    m_product mp
                                              where tc.product_id = mp.product_id
                                              and upper(mp.product_name) = '2T POUCH'
                                              and tc.closing_id in (:closing_id)
                                              group by mp.product_name,mp.price`,
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
            
              ` SELECT 
                                  DATE_FORMAT(tts.invoice_date, '%d-%m-%Y') invoice_date,
                                  tts.invoice_number,
                                  (SELECT 
                                          SUM(amount)
                                      FROM
                                          t_tank_stk_rcpt_dtl
                                      WHERE
                                          ttank_id = tts.ttank_id) invoice_amount,
                                  DATE_FORMAT(tts.decant_date, '%d-%m-%Y') decant_date,
                                  tts.decant_time,
                                  tts.truck_number,
                                  tts.location_code,
                                  tts.odometer_reading,
                                  (SELECT 
                                          person_name
                                      FROM
                                          m_persons
                                      WHERE
                                          person_id = driver_id) driver,
                                  (SELECT 
                                          person_name
                                      FROM
                                          m_persons
                                      WHERE
                                          person_id = helper_id) helper,
                                  (SELECT 
                                          person_name
                                      FROM
                                          m_persons
                                      WHERE
                                          person_id = decant_incharge) decant_incharge,
                                          0 product
                              FROM
                                  t_tank_stk_rcpt tts
                              WHERE
                                  tts.cashflow_date = :cashflow_date
                              AND tts.location_code = :location_code`    ,                              
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
                                            and coalesce(card_flag,'N') <> 'Y'
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
          (select given_qty-returned_qty from t_2toil toil,m_product mp where closing_id =tc.closing_id and toil.product_id = mp.product_id
          and upper(mp.product_name) = '2T LOOSE' ) loose,
          tc.notes,
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
          tc.closing_id, tc.location_code, mper.Person_Name, mper.Person_id, mper.Role, tc.closing_date,tc.notes`;
      
      // Execute the query
      const result = await db.sequelize.query(query,  {
        replacements: {closing_id: closing_id}, 
        type: Sequelize.QueryTypes.SELECT
        });
            
            
            return result;
        
    },
    getfuelstock: async (locationCode, reportDate) => {
        console.log('ibsdie getfuelstock ')
        
        const result = await db.sequelize.query(            
              ` SELECT 
                            (SELECT 
                                    tank_code
                                FROM
                                    m_tank
                                WHERE
                                    tank_id = a.tank_id) tank,
                            GET_TANK_OPENING_STOCK(a.tank_id, a.closing_date) opening,
                            (SELECT 
                                    COALESCE(SUM(ttd.quantity * 1000), 0)
                                FROM
                                    t_tank_stk_rcpt_dtl ttd,
                                    t_tank_stk_rcpt ttsr
                                WHERE
                                    ttd.tank_id = a.tank_id
                                        AND ttsr.ttank_id = ttd.ttank_id
                                        AND ttsr.decant_date >= a.closing_date
                                        AND ttsr.decant_date <= a.closing_date) offtake,
                            (SELECT 
                                    SUM(tr.closing_reading - tr.opening_reading)
                                FROM
                                    t_reading tr,
                                    t_closing tc,
                                    m_pump_tank mpt
                                WHERE
                                    tc.location_code = mpt.location_code
                                        AND tc.closing_date = a.closing_date
                                        AND tc.closing_id = tr.closing_id
                                        AND tr.pump_id = mpt.pump_id
                                        AND mpt.tank_id = a.tank_id) sales,
                            (SELECT 
                                    SUM(tr.testing)
                                FROM
                                    t_reading tr,
                                    t_closing tc,
                                    m_pump_tank mpt
                                WHERE
                                    tc.location_code = mpt.location_code
                                        AND tc.closing_date = a.closing_date
                                        AND tc.closing_id = tr.closing_id
                                        AND tr.pump_id = mpt.pump_id
                                        AND mpt.tank_id = a.tank_id) testing,
                            GET_TANK_CLOSING_STOCK(a.tank_id, a.closing_date) closing
                        FROM
                            (SELECT 
                                mpt.tank_id, tc.closing_date, mpt.location_code
                            FROM
                                t_reading tr
                            JOIN t_closing tc ON tr.closing_id = tc.closing_id
                            JOIN m_pump_tank mpt ON tr.pump_id = mpt.pump_id
                            WHERE
                                DATE(tc.closing_date) = :stock_date
                                    AND mpt.location_code = :location_code
                            GROUP BY mpt.tank_id , tc.closing_date , mpt.location_code) a`    ,                              
            {
            replacements: {location_code:locationCode,stock_date: reportDate}, 
            type: Sequelize.QueryTypes.SELECT }
         );
         // Proper debugging of results
        //  console.log('Debug: Query completed');
        //  console.log('Debug: Result type:', typeof result);
        //  console.log('Debug: Is array?', Array.isArray(result));
        //  console.log('Debug: Result length:', result ? result.length : 'null/undefined');
        //  console.log('Debug: Full result:', JSON.stringify(result, null, 2));

        return result;

    }      


}

