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
            DATE(tcl.closing_date) as invoice_date,
            mcl.gst as customer_gstin,
            mcl.Company_Name as customer_name,
            mp.hsn_code,
            mp.product_name,
            SUM(tc.qty) as quantity,
            tc.price as rate,
            SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value,
            
            COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) as cgst_percent,
            COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) as sgst_percent,
            
            CASE 
                WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN SUM(tc.cgst_amount)
                ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
            END as cgst_amount,
            
            CASE 
                WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN SUM(tc.sgst_amount)
                ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100)
            END as sgst_amount,
            
            0 as igst_amount,
            
            SUM(
                COALESCE(tc.base_amount, tc.amount) + 
                CASE 
                    WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN tc.cgst_amount
                    ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100
                END +
                CASE 
                    WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN tc.sgst_amount
                    ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100
                END
            ) as invoice_value
        FROM t_credits tc
        JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
        JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
        JOIN m_product mp ON tc.product_id = mp.product_id
        WHERE tcl.location_code = :locationCode
            AND tcl.closing_status = 'CLOSED'
            AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            AND mcl.gst IS NOT NULL
            AND mcl.gst != ''
            AND LENGTH(mcl.gst) = 15
            AND COALESCE(mcl.card_flag, 'N') != 'Y'
            AND (
                COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) > 0
                OR COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) > 0
            )
        GROUP BY tc.bill_no, invoice_date, customer_gstin, customer_name, 
                 mp.hsn_code, mp.product_name, tc.price, tc.cgst_percent, tc.sgst_percent,
                 mp.cgst_percent, mp.sgst_percent, tc.cgst_amount, tc.sgst_amount
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
                DATE(tcl.closing_date) as invoice_date,
                mp.hsn_code,
                mp.product_name,
                SUM(tc.qty) as quantity,
                tc.price as rate,
                SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value,
                
                COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) as cgst_percent,
                COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) as sgst_percent,
                
                CASE 
                    WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN SUM(tc.cgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN SUM(tc.sgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                END as sgst_amount,
                
                SUM(
                    COALESCE(tc.base_amount, tc.amount) + 
                    CASE 
                        WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN tc.cgst_amount
                        ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100
                    END +
                    CASE 
                        WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN tc.sgst_amount
                        ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100
                    END
                ) as invoice_value
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (mcl.gst IS NULL OR mcl.gst = '')
                AND COALESCE(mcl.card_flag, 'N') != 'Y'
                AND (
                    COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) > 0
                    OR COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) > 0
                )
            GROUP BY tc.bill_no, invoice_date, mp.hsn_code, mp.product_name, 
                     tc.price, tc.cgst_percent, tc.sgst_percent, mp.cgst_percent, 
                     mp.sgst_percent, tc.cgst_amount, tc.sgst_amount
            
            UNION ALL
            
            -- Cash sales
            SELECT 
                tcs.bill_no,
                DATE(tcl.closing_date) as invoice_date,
                mp.hsn_code,
                mp.product_name,
                SUM(tcs.qty) as quantity,
                tcs.price as rate,
                SUM(COALESCE(tcs.base_amount, tcs.amount)) as taxable_value,
                
                COALESCE(NULLIF(tcs.cgst_percent, 0), mp.cgst_percent, 0) as cgst_percent,
                COALESCE(NULLIF(tcs.sgst_percent, 0), mp.sgst_percent, 0) as sgst_percent,
                
                CASE 
                    WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN SUM(tcs.cgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN SUM(tcs.sgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                END as sgst_amount,
                
                SUM(
                    COALESCE(tcs.base_amount, tcs.amount) + 
                    CASE 
                        WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN tcs.cgst_amount
                        ELSE COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100
                    END +
                    CASE 
                        WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN tcs.sgst_amount
                        ELSE COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100
                    END
                ) as invoice_value
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (
                    COALESCE(NULLIF(tcs.cgst_percent, 0), mp.cgst_percent, 0) > 0
                    OR COALESCE(NULLIF(tcs.sgst_percent, 0), mp.sgst_percent, 0) > 0
                )
            GROUP BY tcs.bill_no, invoice_date, mp.hsn_code, mp.product_name,
                     tcs.price, tcs.cgst_percent, tcs.sgst_percent, mp.cgst_percent,
                     mp.sgst_percent, tcs.cgst_amount, tcs.sgst_amount
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
                COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) + 
                COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) as tax_rate,
                SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value,
                
                CASE 
                    WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN SUM(tc.cgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN SUM(tc.sgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                END as sgst_amount,
                
                SUM(
                    COALESCE(tc.base_amount, tc.amount) + 
                    CASE 
                        WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN tc.cgst_amount
                        ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100
                    END +
                    CASE 
                        WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN tc.sgst_amount
                        ELSE COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100
                    END
                ) as invoice_value
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            LEFT JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (mcl.gst IS NULL OR mcl.gst = '')
                AND COALESCE(mcl.card_flag, 'N') != 'Y'
                AND (
                    COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) > 0
                    OR COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) > 0
                )
            GROUP BY tc.bill_no, mp.hsn_code, tc.cgst_percent, tc.sgst_percent, 
                     mp.cgst_percent, mp.sgst_percent, tc.cgst_amount, tc.sgst_amount
            
            UNION ALL
            
            -- Cash sales
            SELECT 
                mp.hsn_code,
                COALESCE(NULLIF(tcs.cgst_percent, 0), mp.cgst_percent, 0) + 
                COALESCE(NULLIF(tcs.sgst_percent, 0), mp.sgst_percent, 0) as tax_rate,
                SUM(COALESCE(tcs.base_amount, tcs.amount)) as taxable_value,
                
                CASE 
                    WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN SUM(tcs.cgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN SUM(tcs.sgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                END as sgst_amount,
                
                SUM(
                    COALESCE(tcs.base_amount, tcs.amount) + 
                    CASE 
                        WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN tcs.cgst_amount
                        ELSE COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100
                    END +
                    CASE 
                        WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN tcs.sgst_amount
                        ELSE COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100
                    END
                ) as invoice_value
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                AND (
                    COALESCE(NULLIF(tcs.cgst_percent, 0), mp.cgst_percent, 0) > 0
                    OR COALESCE(NULLIF(tcs.sgst_percent, 0), mp.sgst_percent, 0) > 0
                )
            GROUP BY tcs.bill_no, mp.hsn_code, tcs.cgst_percent, tcs.sgst_percent,
                     mp.cgst_percent, mp.sgst_percent, tcs.cgst_amount, tcs.sgst_amount
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
            -- FUEL SALES (from pump readings - matches GST Summary report)
            SELECT
                mprod.hsn_code,
                mpump.product_code as product_name,
                'LTR' as uqc,
                SUM(tr.closing_reading - tr.opening_reading - tr.testing) as quantity,
                SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) as taxable_value,
                COALESCE(mprod.cgst_percent, 0) + COALESCE(mprod.sgst_percent, 0) as tax_rate,
                SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price * COALESCE(mprod.cgst_percent, 0) / 100) as cgst_amount,
                SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price * COALESCE(mprod.sgst_percent, 0) / 100) as sgst_amount,
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
            GROUP BY mprod.hsn_code, mpump.product_code, mprod.cgst_percent, mprod.sgst_percent
            
            UNION ALL
            
            -- NON-FUEL CREDIT SALES (from invoices)
            -- Excludes products that are sold through pumps to avoid double counting
            SELECT 
                mp.hsn_code,
                mp.product_name,
                mp.unit as uqc,
                SUM(tc.qty) as quantity,
                SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value,
                COALESCE(NULLIF(tc.cgst_percent, 0), mp.cgst_percent, 0) + 
                COALESCE(NULLIF(tc.sgst_percent, 0), mp.sgst_percent, 0) as tax_rate,
                
                CASE 
                    WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN SUM(tc.cgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN SUM(tc.sgst_amount)
                    ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as sgst_amount,
                
                0 as igst_amount
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                -- Exclude fuel products that are tracked in pump readings
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
            GROUP BY mp.hsn_code, mp.product_name, mp.unit, tc.cgst_percent, tc.sgst_percent,
                     mp.cgst_percent, mp.sgst_percent, tc.cgst_amount, tc.sgst_amount
            
            UNION ALL
            
            -- NON-FUEL CASH SALES (from invoices)
            SELECT 
                mp.hsn_code,
                mp.product_name,
                mp.unit as uqc,
                SUM(tcs.qty) as quantity,
                SUM(COALESCE(tcs.base_amount, tcs.amount)) as taxable_value,
                COALESCE(NULLIF(tcs.cgst_percent, 0), mp.cgst_percent, 0) + 
                COALESCE(NULLIF(tcs.sgst_percent, 0), mp.sgst_percent, 0) as tax_rate,
                
                CASE 
                    WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN SUM(tcs.cgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                END as cgst_amount,
                
                CASE 
                    WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN SUM(tcs.sgst_amount)
                    ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                END as sgst_amount,
                
                0 as igst_amount
            FROM t_cashsales tcs
            JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
            JOIN m_product mp ON tcs.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                -- Exclude fuel products that are tracked in pump readings
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
            GROUP BY mp.hsn_code, mp.product_name, mp.unit, tcs.cgst_percent, tcs.sgst_percent,
                     mp.cgst_percent, mp.sgst_percent, tcs.cgst_amount, tcs.sgst_amount
                     
            UNION ALL
            
            -- 2T OIL SALES (special handling - only if NOT sold through pumps)
            SELECT
                mp.hsn_code,
                mp.product_name,
                mp.unit as uqc,
                SUM(t2t.given_qty - t2t.returned_qty) as quantity,
                SUM((t2t.given_qty - t2t.returned_qty) * t2t.price) as taxable_value,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) as tax_rate,
                SUM((t2t.given_qty - t2t.returned_qty) * t2t.price * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                SUM((t2t.given_qty - t2t.returned_qty) * t2t.price * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                0 as igst_amount
            FROM t_2toil t2t
            JOIN t_closing tcl ON t2t.closing_id = tcl.closing_id
            JOIN m_product mp ON t2t.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tcl.closing_status = 'CLOSED'
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                -- Only include if 2T oil is NOT configured in pumps for this location
                AND mp.product_name NOT IN (
                    SELECT DISTINCT product_code 
                    FROM m_pump 
                    WHERE location_code = :locationCode
                )
            GROUP BY mp.hsn_code, mp.product_name, mp.unit, mp.cgst_percent, mp.sgst_percent
        ) all_sales
        GROUP BY hsn_code, product_name, uqc, tax_rate
        ORDER BY hsn_code, tax_rate DESC
    `;

    const result = await db.sequelize.query(query, {
        replacements: { locationCode, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });

    return result;
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
                    SUM(COALESCE(tc.base_amount, tc.amount)) as taxable_value,
                    
                    CASE 
                        WHEN COALESCE(tc.cgst_amount, 0) > 0 THEN SUM(tc.cgst_amount)
                        ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                    END as cgst_amount,
                    
                    CASE 
                        WHEN COALESCE(tc.sgst_amount, 0) > 0 THEN SUM(tc.sgst_amount)
                        ELSE SUM(COALESCE(tc.base_amount, tc.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                    END as sgst_amount,
                    
                    0 as igst_amount,
                    0 as cess_amount
                FROM t_credits tc
                JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
                JOIN m_product mp ON tc.product_id = mp.product_id
                WHERE tcl.location_code = :locationCode
                    AND tcl.closing_status = 'CLOSED'
                    AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                GROUP BY tc.cgst_amount, tc.sgst_amount
                
                UNION ALL
                
                -- Cash sales
                SELECT 
                    SUM(COALESCE(tcs.base_amount, tcs.amount)) as taxable_value,
                    
                    CASE 
                        WHEN COALESCE(tcs.cgst_amount, 0) > 0 THEN SUM(tcs.cgst_amount)
                        ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.cgst_percent, 0) / 100)
                    END as cgst_amount,
                    
                    CASE 
                        WHEN COALESCE(tcs.sgst_amount, 0) > 0 THEN SUM(tcs.sgst_amount)
                        ELSE SUM(COALESCE(tcs.base_amount, tcs.amount) * COALESCE(mp.sgst_percent, 0) / 100)
                    END as sgst_amount,
                    
                    0 as igst_amount,
                    0 as cess_amount
                FROM t_cashsales tcs
                JOIN t_closing tcl ON tcs.closing_id = tcl.closing_id
                JOIN m_product mp ON tcs.product_id = mp.product_id
                WHERE tcl.location_code = :locationCode
                    AND tcl.closing_status = 'CLOSED'
                    AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
                GROUP BY tcs.cgst_amount, tcs.sgst_amount
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
                'ITC Available' as description,
                SUM(cgst_amount) as cgst_amount,
                SUM(sgst_amount) as sgst_amount,
                SUM(igst_amount) as igst_amount,
                SUM(cess_amount) as cess_amount
            FROM (
                SELECT 
                    SUM(lil.amount * COALESCE(mp.cgst_percent, 0) / 100) as cgst_amount,
                    SUM(lil.amount * COALESCE(mp.sgst_percent, 0) / 100) as sgst_amount,
                    0 as igst_amount,
                    0 as cess_amount
                FROM t_lubes_inv_hdr lih
                JOIN t_lubes_inv_lines lil ON lih.lubes_hdr_id = lil.lubes_hdr_id
                JOIN m_product mp ON lil.product_id = mp.product_id
                WHERE lih.location_code = :locationCode
                    AND lih.closing_status = 'CLOSED'
                    AND DATE(lih.invoice_date) BETWEEN :fromDate AND :toDate
            ) purchases
        `;

        const result = await db.sequelize.query(query, {
            replacements: { locationCode, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        });

        return result[0] || null;
    }
};