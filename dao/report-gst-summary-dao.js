const db = require("../db/db-connection");
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {


   
   getpurchasesummary: async (locationCode, reportFromDate,reportToDate) => {
    
    
    const result = await db.sequelize.query(
                                        `SELECT 
                                        p.product_name Product,
                                        DATE_FORMAT(tr.invoice_date, '%d-%b-%Y') "Date",
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
   getPurchaseSummaryConsolidated: async (locationCode, reportFromDate, reportToDate) => {
    const query = `
      SELECT 
        p.product_name AS Product,
        SUM(trd.quantity * 1000) AS Total_Quantity,
        SUM(trd.amount) AS Total_Amount
      FROM 
        t_tank_stk_rcpt tr
        JOIN t_tank_stk_rcpt_dtl trd ON tr.ttank_id = trd.ttank_id
        JOIN m_tank t ON trd.tank_id = t.tank_id
        JOIN m_product p 
          ON t.product_code = p.product_name 
          AND p.location_code = tr.location_code
      WHERE 
        tr.location_code = :locationCode
        AND tr.invoice_date BETWEEN :reportFromDate AND :reportToDate
      GROUP BY 
        p.product_name
      ORDER BY 
        p.product_name;
    `;
  
    const result = await db.sequelize.query(query, {
      replacements: { locationCode, reportFromDate, reportToDate },
      type: Sequelize.QueryTypes.SELECT
    });
    
    return result;
  },  
   getSalesConsolidated: async (locationCode, reportFromDate, reportToDate) => {
    const query = `
      SELECT
        mp.product_code AS product,
        SUM(tr.closing_reading - tr.opening_reading - tr.testing) AS litres,
        SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) AS amount
      FROM t_closing tc
      JOIN t_reading tr ON tc.closing_id = tr.closing_id
      JOIN m_pump mp 
        ON tr.pump_id = mp.pump_id 
        AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
      WHERE tc.closing_status = 'CLOSED'
        AND tc.location_code = :locationCode
        AND DATE(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
      GROUP BY mp.product_code
      ORDER BY mp.product_code;
    `;
  
    const result = await db.sequelize.query(query, {
      replacements: { locationCode, reportFromDate, reportToDate },
      type: Sequelize.QueryTypes.SELECT
    });
  
    return result;
  },

  getNonFuelSalesConsolidated: async (locationCode, reportFromDate, reportToDate) => {
    const query = `
      SELECT
        mp.product_name AS product,
        SUM(s.qty) AS total_qty,
        SUM(s.amount) AS total_amount
      FROM (
        SELECT closing_id, product_id, qty, amount
        FROM t_credits
        UNION ALL
        SELECT closing_id, product_id, qty, amount
        FROM t_cashsales
        UNION ALL
        SELECT closing_id, product_id, (given_qty - returned_qty) AS qty, ((given_qty - returned_qty) * price) AS amount
        FROM t_2toil
      ) s
      JOIN t_closing tc ON s.closing_id = tc.closing_id
      JOIN m_product mp ON s.product_id = mp.product_id
      WHERE tc.closing_status = 'CLOSED'
        AND tc.location_code = :locationCode
        AND DATE(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
        AND mp.product_name NOT IN (
            SELECT DISTINCT product_code 
            FROM m_pump 
            WHERE location_code = :locationCode
        )
      GROUP BY mp.product_name
      ORDER BY mp.product_name;
    `;
  
    const result = await db.sequelize.query(query, {
      replacements: { locationCode, reportFromDate, reportToDate },
      type: Sequelize.QueryTypes.SELECT,
    });
  
    return result;
  },
  

  
  // NEW METHOD 1: Get Non-Fuel Sales grouped by GST %
  getNonFuelSalesByGST: async (locationCode, reportFromDate, reportToDate) => {
    const query = `
      SELECT
        CONCAT(COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0), '%') AS gst_category,
        SUM(s.qty) AS total_qty,
        SUM(s.amount) AS total_amount,
        SUM(s.amount * COALESCE(mp.cgst_percent, 0) / 100) AS total_cgst,
        SUM(s.amount * COALESCE(mp.sgst_percent, 0) / 100) AS total_sgst
      FROM (
        SELECT closing_id, product_id, qty, amount
        FROM t_credits
        UNION ALL
        SELECT closing_id, product_id, qty, amount
        FROM t_cashsales
        UNION ALL
        SELECT closing_id, product_id, (given_qty - returned_qty) AS qty, 
               ((given_qty - returned_qty) * price) AS amount
        FROM t_2toil
      ) s
      JOIN t_closing tc ON s.closing_id = tc.closing_id
      JOIN m_product mp ON s.product_id = mp.product_id
      WHERE tc.closing_status = 'CLOSED'
        AND tc.location_code = :locationCode
        AND DATE(tc.closing_date) BETWEEN :reportFromDate AND :reportToDate
        AND mp.product_name NOT IN (
            SELECT DISTINCT product_code 
            FROM m_pump 
            WHERE location_code = :locationCode
        )
      GROUP BY gst_category
      ORDER BY gst_category DESC;
    `;
  
    const result = await db.sequelize.query(query, {
      replacements: { locationCode, reportFromDate, reportToDate },
      type: Sequelize.QueryTypes.SELECT,
    });
  
    return result;
  },

  // NEW METHOD 2: Get Non-Fuel (Oil/Lubes) Purchase Summary grouped by GST %
  getNonFuelPurchaseByGST: async (locationCode, reportFromDate, reportToDate) => {
    const query = `
      SELECT
        CONCAT(COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0), '%') AS gst_category,
        SUM(lil.qty) AS total_qty,
        SUM(lil.amount) AS total_amount,
        SUM(lil.amount * COALESCE(mp.cgst_percent, 0) / 100) AS total_cgst,
        SUM(lil.amount * COALESCE(mp.sgst_percent, 0) / 100) AS total_sgst
      FROM t_lubes_inv_hdr lih
      JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
      JOIN m_product mp ON lil.product_id = mp.product_id
      WHERE lih.location_code = :locationCode
        AND lih.closing_status = 'CLOSED'
        AND DATE(lih.invoice_date) BETWEEN :reportFromDate AND :reportToDate
      GROUP BY gst_category
      ORDER BY gst_category DESC;
    `;
  
    const result = await db.sequelize.query(query, {
      replacements: { locationCode, reportFromDate, reportToDate },
      type: Sequelize.QueryTypes.SELECT,
    });
  
    return result;
  },

  // NEW METHOD 3: Get Non-Fuel Purchase Invoice Details grouped by GST %
  getNonFuelPurchaseInvoicesByGST: async (locationCode, reportFromDate, reportToDate) => {
  const query = `
    SELECT
      CONCAT(COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0), '%') AS gst_category,
      ms.supplier_name AS "Supplier Name",
      COALESCE(ms.gstin, '-') AS "Supplier GSTIN",
      mp.product_name AS Product,
      DATE_FORMAT(lih.invoice_date, '%d-%b-%Y') AS "Date",
      lih.invoice_number AS "Invoice-Number",
      lil.qty AS "Quantity",
      lil.amount AS Amount
    FROM t_lubes_inv_hdr lih
    JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
    JOIN m_supplier ms ON lih.supplier_id = ms.supplier_id
    JOIN m_product mp ON lil.product_id = mp.product_id
    WHERE lih.location_code = :locationCode
      AND lih.closing_status = 'CLOSED'
      AND DATE(lih.invoice_date) BETWEEN :reportFromDate AND :reportToDate
    ORDER BY gst_category DESC, lih.invoice_date, ms.supplier_name, mp.product_name;
  `;

  const result = await db.sequelize.query(query, {
    replacements: { locationCode, reportFromDate, reportToDate },
    type: Sequelize.QueryTypes.SELECT,
  });

  return result;
}
  
}


