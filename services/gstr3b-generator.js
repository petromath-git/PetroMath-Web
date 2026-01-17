const GstDataAggregationDao = require("../dao/gst-data-aggregation-dao");
const gstUtils = require("../utils/gst-utils");

module.exports = {
    /**
     * Generate complete GSTR-3B JSON
     */

generateGSTR3BJson: async (locationCode, gstin, returnPeriod) => {
    try {
        // Get period dates
        const periodDates = gstUtils.getPeriodDates(returnPeriod);
        const { from_date, to_date, financial_year } = periodDates;

        // Fetch data - ADD nil-rated to the Promise.all
        const [salesSummary, itcSummary, nilRatedSales, nilRatedPurchases] = await Promise.all([
            GstDataAggregationDao.getGSTR3BSalesSummary(locationCode, from_date, to_date),
            GstDataAggregationDao.getGSTR3BITCSummary(locationCode, from_date, to_date),
            GstDataAggregationDao.getNilRatedSalesSummary(locationCode, from_date, to_date),
            GstDataAggregationDao.getNilRatedPurchasesSummary(locationCode, from_date, to_date)
        ]);

        const taxableValue = parseFloat(salesSummary?.taxable_value || 0);
        const cgst = parseFloat(salesSummary?.cgst_amount || 0);
        const sgst = parseFloat(salesSummary?.sgst_amount || 0);
        const igst = parseFloat(salesSummary?.igst_amount || 0);
        const cess = parseFloat(salesSummary?.cess_amount || 0);

        const itcCgst = parseFloat(itcSummary?.cgst_amount || 0);
        const itcSgst = parseFloat(itcSummary?.sgst_amount || 0);
        const itcIgst = parseFloat(itcSummary?.igst_amount || 0);
        const itcCess = parseFloat(itcSummary?.cess_amount || 0);

        // Build GSTR-3B JSON structure
        const gstr3bJson = {
            gstin: gstin,
            ret_period: returnPeriod,
            
            // 3.1 - Outward taxable supplies
            sup_details: {
                osup_det: {
                    txval: taxableValue.toFixed(2),
                    iamt: igst.toFixed(2),
                    camt: cgst.toFixed(2),
                    samt: sgst.toFixed(2),
                    csamt: cess.toFixed(2)
                },
                osup_zero: {
                    txval: "0.00",
                    iamt: "0.00",
                    csamt: "0.00"
                },
                osup_nil_exmp: {
                    txval: nilRatedSales.toFixed(2)  // CHANGED: Now uses actual value instead of "0.00"
                },
                isup_rev: {
                    txval: "0.00",
                    iamt: "0.00",
                    camt: "0.00",
                    samt: "0.00",
                    csamt: "0.00"
                },
                osup_nongst: {
                    txval: "0.00"
                }
            },

            // ... rest of the JSON structure remains the same ...

            // 5 - Values of exempt, nil rated and non-GST inward supplies
            inward_sup: {
                isup_details: [{
                    ty: "GST",
                    inter: "0.00",
                    intra: nilRatedPurchases.toFixed(2)  // CHANGED: Now uses actual value
                }, {
                    ty: "NONGST",
                    inter: "0.00",
                    intra: "0.00"
                }]
            },

            // ... rest remains the same ...
        };

        return {
            success: true,
            data: gstr3bJson,
            summary: {
                total_taxable_value: taxableValue.toFixed(2),
                total_tax: (cgst + sgst + igst + cess).toFixed(2),
                total_itc: (itcCgst + itcSgst + itcIgst + itcCess).toFixed(2),
                net_tax_payable: Math.max(0, (cgst + sgst + igst + cess) - (itcCgst + itcSgst + itcIgst + itcCess)).toFixed(2),
                nil_rated_sales: nilRatedSales.toFixed(2),           // NEW: Add to summary
                nil_rated_purchases: nilRatedPurchases.toFixed(2),   // NEW: Add to summary
                period: gstUtils.formatReturnPeriod(returnPeriod),
                from_date,
                to_date
            }
        };

    } catch (error) {
        console.error('Error generating GSTR-3B JSON:', error);
        return {
            success: false,
            error: error.message
        };
    }
},

    /**
     * Validate GSTR-3B data
     */
   /**
 * Validate GSTR-3B data
 * FIXED: Compare total tax amounts, not just CGST
 */
validateGSTR3BData: async (locationCode, returnPeriod) => {
    const periodDates = gstUtils.getPeriodDates(returnPeriod);
    const { from_date, to_date } = periodDates;

    const errors = [];
    const warnings = [];

    const [salesSummary, itcSummary] = await Promise.all([
        GstDataAggregationDao.getGSTR3BSalesSummary(locationCode, from_date, to_date),
        GstDataAggregationDao.getGSTR3BITCSummary(locationCode, from_date, to_date)
    ]);

    if (!salesSummary || salesSummary.taxable_value === 0) {
        warnings.push('No sales data found for this period');
    }

    // FIXED: Compare total tax (CGST + SGST + IGST), not just CGST
    if (itcSummary && salesSummary) {
        const totalOutputTax = parseFloat(salesSummary.cgst_amount || 0) + 
                              parseFloat(salesSummary.sgst_amount || 0) + 
                              parseFloat(salesSummary.igst_amount || 0);
        
        const totalITC = parseFloat(itcSummary.cgst_amount || 0) + 
                        parseFloat(itcSummary.sgst_amount || 0) + 
                        parseFloat(itcSummary.igst_amount || 0);
        
        if (totalITC > totalOutputTax) {
            warnings.push('ITC is greater than output tax - ensure this is correct');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

};