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

            // Fetch data
            const [salesSummary, itcSummary] = await Promise.all([
                GstDataAggregationDao.getGSTR3BSalesSummary(locationCode, from_date, to_date),
                GstDataAggregationDao.getGSTR3BITCSummary(locationCode, from_date, to_date)
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
                        txval: "0.00"
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

                // 3.2 - Inter-state supplies (if any)
                inter_sup: {
                    unreg_details: [],
                    comp_details: [],
                    uin_details: []
                },

                // 4 - Eligible ITC
                itc_elg: {
                    itc_avl: [{
                        ty: "IMPG", // Import of goods
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "IMPS", // Import of services
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "ISRC", // ITC on reverse charge
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "ISD", // ITC from ISD
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "OTH", // All other ITC
                        iamt: itcIgst.toFixed(2),
                        camt: itcCgst.toFixed(2),
                        samt: itcSgst.toFixed(2),
                        csamt: itcCess.toFixed(2)
                    }],
                    itc_rev: [{
                        ty: "RUL", // ITC reversed as per rules
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "OTH", // Other reversals
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }],
                    itc_net: {
                        iamt: itcIgst.toFixed(2),
                        camt: itcCgst.toFixed(2),
                        samt: itcSgst.toFixed(2),
                        csamt: itcCess.toFixed(2)
                    },
                    itc_inelg: [{
                        ty: "RUL", // As per section 17(5)
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }, {
                        ty: "OTH", // Others
                        iamt: "0.00",
                        camt: "0.00",
                        samt: "0.00",
                        csamt: "0.00"
                    }]
                },

                // 5 - Values of exempt, nil rated and non-GST supplies
                inward_sup: {
                    isup_details: [{
                        ty: "GST",
                        inter: "0.00",
                        intra: "0.00"
                    }, {
                        ty: "NONGST",
                        inter: "0.00",
                        intra: "0.00"
                    }]
                },

                // 6.1 - Payment of tax
                intr_details: {
                    intrDetails: {
                        iamt: Math.max(0, igst - itcIgst).toFixed(2),
                        camt: Math.max(0, cgst - itcCgst).toFixed(2),
                        samt: Math.max(0, sgst - itcSgst).toFixed(2),
                        csamt: Math.max(0, cess - itcCess).toFixed(2)
                    }
                }
            };

            return {
                success: true,
                data: gstr3bJson,
                summary: {
                    total_taxable_value: taxableValue.toFixed(2),
                    total_tax: (cgst + sgst + igst + cess).toFixed(2),
                    total_itc: (itcCgst + itcSgst + itcIgst + itcCess).toFixed(2),
                    net_tax_payable: Math.max(0, (cgst + sgst + igst + cess) - (itcCgst + itcSgst + itcIgst + itcCess)).toFixed(2),
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

        if (itcSummary && (itcSummary.cgst_amount > salesSummary.cgst_amount)) {
            warnings.push('ITC is greater than output tax - ensure this is correct');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
};