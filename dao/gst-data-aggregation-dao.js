const db = require("../db/db-connection");
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const gstUtils = require("../utils/gst-utils");

module.exports = {
    /**
     * Get B2B Sales Data for GSTR-1
     * Sales to customers with GSTIN (Credit customers)
     */
    /**
 * Get B2B Sales Data for GSTR-1
 * Sales to customers with GSTIN (Credit customers)
 * EXCLUDES nil-rated supplies (petrol/diesel)
 */
getB2BSalesData: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            tc.bill_no,
            COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) as invoice_date,
            mcl.gst as customer_gstin,
            COALESCE(mcl.Company_Name, 'Unknown') as customer_name,
            mp.hsn_code,
            mp.product_name,
            SUM(tc.qty) as quantity,
            tc.price as rate,
            SUM(tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
            
            COALESCE(mp.cgst_percent, 0) as cgst_percent,
            COALESCE(mp.sgst_percent, 0) as sgst_percent,
            
            SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
            
            SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
            
            0 as igst_amount,
            
            SUM(tc.amount) as invoice_value
        FROM t_credits tc
        JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
        LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
        JOIN m_product mp ON tc.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
            AND mcl.gst IS NOT NULL
            AND mcl.gst != ''
            AND COALESCE(mcl.card_flag, 'N') != 'Y'
            AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
        GROUP BY tc.bill_no, invoice_date, customer_gstin, customer_name, 
                 mp.hsn_code, mp.product_name, tc.price, mp.cgst_percent, mp.sgst_percent
        ORDER BY invoice_date, tc.bill_no
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},

    /**
     * Get B2C Large Sales Data for GSTR-1
     * Cash/Credit sales without GSTIN, invoice value > 2.5 lakh
     */
getB2CLSalesData: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            bill_no,
            invoice_date,
            '' as customer_gstin,
            'B2C' as customer_name,
            hsn_code,
            product_name,
            quantity,
            rate,
            taxable_value,
            cgst_percent,
            sgst_percent,
            cgst_amount,
            sgst_amount,
            0 as igst_amount,
            invoice_value
        FROM (
            -- Credit sales without GSTIN
            SELECT 
                tc.bill_no,
                COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) as invoice_date,
                mp.hsn_code,
                mp.product_name,
                SUM(tc.qty) as quantity,
                tc.price as rate,
                SUM(tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                
                COALESCE(mp.cgst_percent, 0) as cgst_percent,
                COALESCE(mp.sgst_percent, 0) as sgst_percent,
                
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                
                SUM(tc.amount) as invoice_value
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (mcl.gst IS NULL OR mcl.gst = '')
                AND COALESCE(mcl.card_flag, 'N') != 'Y'
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY tc.bill_no, invoice_date, mp.hsn_code, mp.product_name,
                     tc.price, mp.cgst_percent, mp.sgst_percent
            
            UNION ALL
            
            -- Cash sales
            SELECT 
                tcs.bill_no,
                DATE(tcl.closing_date) as invoice_date,
                mp.hsn_code,
                mp.product_name,
                SUM(tcs.qty) as quantity,
                tcs.price as rate,
                SUM(tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                
                COALESCE(mp.cgst_percent, 0) as cgst_percent,
                COALESCE(mp.sgst_percent, 0) as sgst_percent,
                
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                
                SUM(tcs.amount) as invoice_value
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY tcs.bill_no, invoice_date, mp.hsn_code, mp.product_name,
                     tcs.price, mp.cgst_percent, mp.sgst_percent
        ) sales
        WHERE invoice_value > 250000
        ORDER BY invoice_date, bill_no
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},
    /**
     * Get B2C Small Sales Data for GSTR-1 (HSN-wise summary)
     * Cash/Credit sales without GSTIN, invoice value <= 2.5 lakh
     */
getB2CSSalesData: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            hsn_code,
            tax_rate,
            SUM(taxable_value) as taxable_value,
            SUM(cgst_amount) as cgst_amount,
            SUM(sgst_amount) as sgst_amount,
            0 as igst_amount
        FROM (
            -- Credit sales without GSTIN
            SELECT 
                mp.hsn_code,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM(tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                
                SUM(tc.amount) as invoice_value
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (mcl.gst IS NULL OR mcl.gst = '' OR mcl.gst = '0')
                AND COALESCE(mcl.card_flag, 'N') != 'Y'
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY tc.bill_no, mp.hsn_code, mp.cgst_percent, mp.sgst_percent
            
            UNION ALL
            
            -- Cash sales
            SELECT 
                mp.hsn_code,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM(tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                
                SUM(tcs.amount) as invoice_value
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY tcs.bill_no, mp.hsn_code, mp.cgst_percent, mp.sgst_percent
            
            UNION ALL
            
            -- 2T Oil sales
            SELECT 
                mp.hsn_code,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM(((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                
                SUM((t2t.given_qty - t2t.returned_qty) * t2t.price) as invoice_value
            FROM t_2toil t2t
            JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
            JOIN m_product mp ON t2t.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
            GROUP BY tcl.closing_date, mp.hsn_code, mp.cgst_percent, mp.sgst_percent
        ) sales
        WHERE invoice_value <= 250000
        GROUP BY hsn_code, tax_rate
        ORDER BY hsn_code
        
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},
    /**
     * Get HSN-wise summary for GSTR-1
     */
/**
 * Get HSN-wise summary for GSTR-1
 * HYBRID APPROACH:
 * - Fuel products: Use pump readings (t_reading) - matches GST Summary logic
 * - Non-fuel products: Use invoice data (t_credits, t_cashsales, t_2toil)
 */
getHSNSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            hsn_code,
            product_name,
            uqc,
            SUM(quantity) as total_quantity,
            SUM(taxable_value) as total_taxable_value,
            tax_rate,
            SUM(cgst_amount) as total_cgst,
            SUM(sgst_amount) as total_sgst,
            SUM(igst_amount) as total_igst
        FROM (
            -- FUEL SALES (from pump readings - keep as is, already correct)
            SELECT
                mprod.hsn_code,
                mpump.product_code as product_name,
                'LTR' as uqc,
                SUM(tr.closing_reading - tr.opening_reading - tr.testing) as quantity,
                SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) as taxable_value,
                0 as tax_rate,
                0 as cgst_amount,
                0 as sgst_amount,
                0 as igst_amount
            FROM t_closing tc
            JOIN t_reading tr ON tc.closing_id = tr.closing_id
            JOIN m_pump mpump ON tr.pump_id = mpump.pump_id 
                AND DATE(tc.closing_date) BETWEEN mpump.effective_start_date AND mpump.effective_end_date
            JOIN m_product mprod ON mpump.product_code = mprod.product_name
                AND mprod.location_code = tc.location_code
            WHERE tc.closing_status = 'CLOSED'
                AND tc.location_code = :locationCode
                AND DATE(tc.closing_date) BETWEEN :fromDate AND :toDate
            GROUP BY mprod.hsn_code, mpump.product_code
            
            UNION ALL
            
            -- CREDIT SALES (lubricants and other non-fuel items)
            SELECT 
                mp.hsn_code,
                mp.product_name,
                'NOS' as uqc,
                SUM(tc.qty) as quantity,
                SUM(tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY mp.hsn_code, mp.product_name, mp.cgst_percent, mp.sgst_percent
            
            UNION ALL
            
            -- CASH SALES (lubricants and other non-fuel items)
            SELECT 
                mp.hsn_code,
                mp.product_name,
                'NOS' as uqc,
                SUM(tcs.qty) as quantity,
                SUM(tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            GROUP BY mp.hsn_code, mp.product_name, mp.cgst_percent, mp.sgst_percent
            
            UNION ALL
            
            -- 2T OIL SALES
            SELECT 
                mp.hsn_code,
                mp.product_name,
                'LTR' as uqc,
                SUM(t2t.given_qty - t2t.returned_qty) as quantity,
                SUM(((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount
            FROM t_2toil t2t
            JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
            JOIN m_product mp ON t2t.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
            GROUP BY mp.hsn_code, mp.product_name, mp.cgst_percent, mp.sgst_percent
        ) all_sales
        GROUP BY hsn_code, product_name, uqc, tax_rate
        ORDER BY hsn_code
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},


/**
 * Get 2T Oil sales summary for GSTR-1
 */
get2TOilSalesSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            SUM(((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
            SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
            SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
            0 as igst_amount
        FROM t_2toil t2t
        JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
        JOIN m_product mp ON t2t.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            AND mp.product_name NOT IN (
                SELECT DISTINCT product_code 
                FROM m_pump 
                WHERE location_code = :locationCode
            )
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result[0] || { taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 };
},

    /**
     * Get Purchase data for GSTR-3B (ITC - Input Tax Credit)
     * FIXED: t_lubes_inv_lines doesn't have GST fields, calculate from m_product
     */
   /**
 * Get Purchase data for GSTR-3B (ITC - Input Tax Credit)
 * Now with supplier GSTIN
 */
getPurchaseData: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            lih.invoice_number,
            lih.invoice_date,
            ms.gstin as supplier_gstin,
            ms.supplier_name,
            mp.hsn_code,
            SUM(lil.qty) as quantity,
            SUM(lil.amount) as taxable_value,
            
            -- Use product master for GST rates (t_lubes_inv_lines doesn't have GST fields)
            COALESCE(mp.cgst_percent, 0) as cgst_percent,
            COALESCE(mp.sgst_percent, 0) as sgst_percent,
            
            -- Calculate GST amounts from product master
            SUM(lil.amount * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
            SUM(lil.amount * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
            
            0 as igst_amount
        FROM t_lubes_inv_hdr lih
        JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
        JOIN m_supplier ms ON lih.supplier_id = ms.supplier_id
        JOIN m_product mp ON lil.product_id = mp.product_id
        WHERE lih.location_code = :locationCode
            AND lih.closing_status = 'CLOSED'
            AND DATE(lih.invoice_date) BETWEEN :fromDate AND :toDate
        GROUP BY lih.invoice_number, lih.invoice_date, ms.gstin, ms.supplier_name,
                 mp.hsn_code, mp.cgst_percent, mp.sgst_percent
        ORDER BY lih.invoice_date
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},

    /**
     * Get summary data for GSTR-3B Table 3.1
     * Outward taxable supplies
     */
getGSTR3BSalesSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            'Outward Taxable Supplies' as description,
            SUM(taxable_value) as taxable_value,
            SUM(cgst_amount) as cgst_amount,
            SUM(sgst_amount) as sgst_amount,
            SUM(igst_amount) as igst_amount,
            SUM(cess_amount) as cess_amount
        FROM (
            -- Credit sales
            SELECT 
                SUM(tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount,
                0 as cess_amount
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            
            UNION ALL
            
            -- Cash sales
            SELECT 
                SUM(tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount,
                0 as cess_amount
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
            
            UNION ALL
            
            -- 2T Oil sales
            SELECT 
                SUM(((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) as taxable_value,
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount,
                0 as cess_amount
            FROM t_2toil t2t
            JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
            JOIN m_product mp ON t2t.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
        ) all_sales
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result[0] || null;
},

    /**
     * Get ITC (Input Tax Credit) summary for GSTR-3B Table 4
     */
    getGSTR3BITCSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            'Input Tax Credit' as description,
            SUM((lil.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
            SUM((lil.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
            0 as igst_amount,
            0 as cess_amount
        FROM t_lubes_inv_hdr lih
        JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
        JOIN m_product mp ON lil.product_id = mp.product_id
        WHERE lih.location_code = :locationCode
            AND lih.closing_status = 'CLOSED'
            AND DATE(lih.invoice_date) BETWEEN :fromDate AND :toDate
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result[0] || null;
},
    /**
 * Get detailed breakdown of sales for GSTR-3B preview
 * Returns itemized list of credit, cash, and 2T oil sales
 */
getGSTR3BSalesBreakdown: async (locationCode, fromDate, toDate) => {
    const creditSalesQuery = `
        SELECT 
            tc.bill_no,
            DATE_FORMAT(COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)), '%d-%b-%Y') as invoice_date,
            COALESCE(mcl.Company_Name, 'Cash Customer') as customer_name,
            mp.product_name,
            tc.qty as quantity,
            tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100) as taxable_value,
            COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as gst_rate,
            (tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100 as cgst,
            (tc.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100 as sgst
        FROM t_credits tc
        JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
        LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
        JOIN m_product mp ON tc.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
            AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
        ORDER BY COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)), tc.bill_no
    `;

    const cashSalesQuery = `
        SELECT 
            tcs.bill_no,
            DATE_FORMAT(tcl.closing_date, '%d-%b-%Y') as invoice_date,
            mp.product_name,
            tcs.qty as quantity,
            tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100) as taxable_value,
            COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as gst_rate,
            (tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100 as cgst,
            (tcs.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100 as sgst
        FROM t_cashsales tcs
        JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
        JOIN m_product mp ON tcs.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            AND (COALESCE(mp.cgst_percent, 0) > 0 OR COALESCE(mp.sgst_percent, 0) > 0)
        ORDER BY tcl.closing_date, tcs.bill_no
    `;

    const twoTOilSalesQuery = `
        SELECT 
            DATE_FORMAT(tcl.closing_date, '%d-%b-%Y') as invoice_date,
            mp.product_name,
            (t2t.given_qty - t2t.returned_qty) as quantity,
            t2t.price as rate,
            ((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100) as taxable_value,
            COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as gst_rate,
            (((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100 as cgst,
            (((t2t.given_qty - t2t.returned_qty) * t2t.price) / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100 as sgst
        FROM t_2toil t2t
        JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
        JOIN m_product mp ON t2t.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            AND mp.product_name NOT IN (
                SELECT DISTINCT product_code 
                FROM m_pump 
                WHERE location_code = :locationCode
            )
        ORDER BY tcl.closing_date
    `;

    const [creditSales, cashSales, twoTOilSales] = await Promise.all([
        db.sequelize.query(creditSalesQuery, {
            replacements: { locationCode, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        }),
        db.sequelize.query(cashSalesQuery, {
            replacements: { locationCode, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        }),
        db.sequelize.query(twoTOilSalesQuery, {
            replacements: { locationCode, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        })
    ]);

    return {
        creditSales,
        cashSales,
        twoTOilSales
    };
},

/**
 * Get detailed breakdown of purchases for GSTR-3B preview
 * Returns itemized list of purchase invoices with ITC
 */
getGSTR3BPurchaseBreakdown: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            lih.invoice_number,
            DATE_FORMAT(lih.invoice_date, '%d-%b-%Y') as invoice_date,
            ms.supplier_name,
            mp.hsn_code,
            mp.product_name,
            lil.qty as quantity,
            lil.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100) as taxable_value,
            COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as gst_rate,
            (lil.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.cgst_percent, 0) / 100 as cgst,
            (lil.amount / (1 + (COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0)) / 100)) * COALESCE(mp.sgst_percent, 0) / 100 as sgst
        FROM t_lubes_inv_hdr lih
        JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
        JOIN m_supplier ms ON lih.supplier_id = ms.supplier_id
        JOIN m_product mp ON lil.product_id = mp.product_id
        WHERE lih.location_code = :locationCode
            AND lih.closing_status = 'CLOSED'
            AND DATE(lih.invoice_date) BETWEEN :fromDate AND :toDate
        ORDER BY lih.invoice_date, lih.invoice_number
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
},
/**
 * Get nil-rated (0% GST) sales summary for GSTR-3B Table 5
 * Returns total value of fuel and other 0% GST sales
 */
getNilRatedSalesSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            SUM(taxable_value) as total_nil_rated_sales
        FROM (
            -- Fuel sales from pump readings (0% GST)
            SELECT
                SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) as taxable_value
            FROM t_closing tc
            JOIN t_reading tr ON tc.closing_id = tr.closing_id
            JOIN m_pump mpump ON tr.pump_id = mpump.pump_id 
                AND DATE(tc.closing_date) BETWEEN mpump.effective_start_date AND mpump.effective_end_date
            JOIN m_product mprod ON mpump.product_code = mprod.product_name
                AND mprod.location_code = tc.location_code
            WHERE tc.closing_status = 'CLOSED'
                AND tc.location_code = :locationCode
                AND DATE(tc.closing_date) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mprod.cgst_percent, 0) = 0 AND COALESCE(mprod.sgst_percent, 0) = 0)
            
            UNION ALL
            
            -- Credit sales with 0% GST (if any)
            SELECT 
                SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND COALESCE(tc.credit_bill_date, DATE(tcl.closing_date)) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) = 0 AND COALESCE(mp.sgst_percent, 0) = 0)
            
            UNION ALL
            
            -- Cash sales with 0% GST (if any)
            SELECT 
                SUM(COALESCE(tcs.base_amount, tcs.amount)) as taxable_value
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (COALESCE(mp.cgst_percent, 0) = 0 AND COALESCE(mp.sgst_percent, 0) = 0)
        ) all_nil_rated
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return parseFloat(result[0]?.total_nil_rated_sales || 0);
},

/**
 * Get nil-rated (0% GST) purchases summary for GSTR-3B Table 5
 * Returns total value of fuel and other 0% GST purchases
 */
getNilRatedPurchasesSummary: async (locationCode, fromDate, toDate) => {
    const query = `
        SELECT 
            SUM(lil.amount) as total_nil_rated_purchases
        FROM t_lubes_inv_hdr lih
        JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
        JOIN m_product mp ON lil.product_id = mp.product_id
        WHERE lih.location_code = :locationCode
            AND lih.closing_status = 'CLOSED'
            AND DATE(lih.invoice_date) BETWEEN :fromDate AND :toDate
            AND (COALESCE(mp.cgst_percent, 0) = 0 AND COALESCE(mp.sgst_percent, 0) = 0)
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return parseFloat(result[0]?.total_nil_rated_purchases || 0);
},

};
