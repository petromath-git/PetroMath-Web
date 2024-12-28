const db = require("../db/db-connection");
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {


   
   getpurchasesummary: async (locationCode, reportFromDate,reportToDate) => {
    
    
    const result = await db.sequelize.query(
                                        `SELECT 
                                        p.product_name Product,
                                        tr.invoice_date "Date",
                                        tr.invoice_number "Invoice-Number",
                                        trd.quantity*1000  "Quantity",                                       
                                        trd.amount Amount
                                    FROM 
                                        t_tank_stk_rcpt tr,
                                    t_tank_stk_rcpt_dtl trd ,
                                    m_tank t,
                                    m_product p
                                    WHERE 
                                    tr.ttank_id = trd.ttank_id
                                    AND trd.tank_id = t.tank_id
                                    AND t.product_code = p.product_name     
                                    AND p.location_code = tr.location_code
                                    AND tr.location_code = :locationCode
                                    AND tr.invoice_date BETWEEN :reportFromDate AND :reportToDate
                                    ORDER BY 
                                        p.product_name, tr.invoice_date`,
        {
          replacements: {locationCode: locationCode,reportFromDate: reportFromDate ,reportToDate: reportToDate}, 
          type: Sequelize.QueryTypes.SELECT
        }

    
      );
      
      
      return result;

   },
 
 


}

