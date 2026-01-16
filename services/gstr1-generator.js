const GstDataAggregationDao = require("../dao/gst-data-aggregation-dao");
const gstUtils = require("../utils/gst-utils");

module.exports = {
    /**
     * Generate complete GSTR-1 JSON
     */
    generateGSTR1Json: async (locationCode, gstin, returnPeriod) => {
        try {
            // Get period dates
            const periodDates = gstUtils.getPeriodDates(returnPeriod);
            const { from_date, to_date, financial_year } = periodDates;

            // Fetch all required data in parallel
            const [b2bData, b2clData, b2csData, hsnData] = await Promise.all([
                GstDataAggregationDao.getB2BSalesData(locationCode, from_date, to_date),
                GstDataAggregationDao.getB2CLSalesData(locationCode, from_date, to_date),
                GstDataAggregationDao.getB2CSSalesData(locationCode, from_date, to_date),
                GstDataAggregationDao.getHSNSummary(locationCode, from_date, to_date)
            ]);

            // Build GSTR-1 JSON structure
            const gstr1Json = {
                gstin: gstin,
                fp: returnPeriod, // Financial Period in MMYYYY format
                gt: calculateGrandTotal(b2bData, b2clData, b2csData), // Grand Total
                cur_gt: calculateGrandTotal(b2bData, b2clData, b2csData), // Current period grand total
                
                // B2B Invoices
                b2b: formatB2BData(b2bData),
                
                // B2C Large Invoices (> 2.5 lakh)
                b2cl: formatB2CLData(b2clData),
                
                // B2C Small - Other (State-wise summary)
                b2cs: formatB2CSData(b2csData, gstin),
                
                // HSN Summary
                hsn: formatHSNData(hsnData),
                
                // Documents Issued (if needed)
                doc_issue: generateDocumentSummary(b2bData, b2clData, b2csData),
                
                // Nil rated, exempted and non-GST supplies (if any)
                nil: {
                    inv: []
                }
            };

            return {
                success: true,
                data: gstr1Json,
                summary: {
                    total_b2b_invoices: b2bData.length,
                    total_b2cl_invoices: b2clData.length,
                    total_b2cs_entries: b2csData.length,
                    total_hsn_entries: hsnData.length,
                    period: gstUtils.formatReturnPeriod(returnPeriod),
                    from_date,
                    to_date
                }
            };

        } catch (error) {
            console.error('Error generating GSTR-1 JSON:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Validate GSTR-1 data before generation
     */
    validateGSTR1Data: async (locationCode, returnPeriod) => {
        const periodDates = gstUtils.getPeriodDates(returnPeriod);
        const { from_date, to_date } = periodDates;

        const errors = [];
        const warnings = [];

        // Fetch data
        const [b2bData, hsnData] = await Promise.all([
            GstDataAggregationDao.getB2BSalesData(locationCode, from_date, to_date),
            GstDataAggregationDao.getHSNSummary(locationCode, from_date, to_date)
        ]);

        // Validate B2B data
        b2bData.forEach((invoice, index) => {
            if (!invoice.customer_gstin || !gstUtils.isValidGstin(invoice.customer_gstin)) {
                errors.push(`B2B Invoice ${invoice.bill_no}: Invalid customer GSTIN`);
            }
            if (!invoice.hsn_code) {
                warnings.push(`B2B Invoice ${invoice.bill_no}: Missing HSN code`);
            }
            if (invoice.taxable_value <= 0) {
                errors.push(`B2B Invoice ${invoice.bill_no}: Invalid taxable value`);
            }
        });

        // Validate HSN data
        hsnData.forEach((hsn, index) => {
            if (!hsn.hsn_code) {
                errors.push(`HSN entry ${index + 1}: Missing HSN code`);
            }
            if (!gstUtils.isValidHsnCode(hsn.hsn_code)) {
                warnings.push(`HSN code ${hsn.hsn_code}: Invalid format`);
            }
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
};

// ============= Helper Functions =============

/**
 * Format B2B data for GSTR-1
 */
function formatB2BData(b2bData) {
    if (!b2bData || b2bData.length === 0) return [];

    // Group by customer GSTIN
    const groupedByGstin = {};
    
    b2bData.forEach(row => {
        const gstin = row.customer_gstin;
        if (!groupedByGstin[gstin]) {
            groupedByGstin[gstin] = {
                ctin: gstin, // Customer GSTIN
                inv: []
            };
        }

        // Check if invoice already exists
        let invoice = groupedByGstin[gstin].inv.find(inv => inv.inum === row.bill_no);
        
        if (!invoice) {
            invoice = {
                inum: row.bill_no, // Invoice number
                idt: formatDate(row.invoice_date), // Invoice date (DD-MM-YYYY)
                val: parseFloat(row.invoice_value || 0).toFixed(2), // Invoice value
                pos: row.customer_gstin.substring(0, 2), // Place of supply (state code from GSTIN)
                rchrg: "N", // Reverse charge
                inv_typ: "R", // Invoice type: R=Regular, SEZWP=SEZ with payment, SEZWOP=SEZ without payment
                itms: []
            };
            groupedByGstin[gstin].inv.push(invoice);
        }

        // Add item to invoice
        invoice.itms.push({
            num: invoice.itms.length + 1, // Item serial number
            itm_det: {
                rt: parseFloat(row.cgst_percent || 0) + parseFloat(row.sgst_percent || 0), // Tax rate
                txval: parseFloat(row.taxable_value || 0).toFixed(2), // Taxable value
                iamt: parseFloat(row.igst_amount || 0).toFixed(2), // IGST amount
                camt: parseFloat(row.cgst_amount || 0).toFixed(2), // CGST amount
                samt: parseFloat(row.sgst_amount || 0).toFixed(2), // SGST amount
                csamt: 0 // Cess amount
            }
        });
    });

    return Object.values(groupedByGstin);
}

/**
 * Format B2CL data for GSTR-1
 */
function formatB2CLData(b2clData) {
    if (!b2clData || b2clData.length === 0) return [];

    // Group by state code (Place of Supply)
    const groupedByState = {};

    b2clData.forEach(row => {
        // For B2C, we don't have customer GSTIN, so use location's state code
        const pos = "33"; // Default to Tamil Nadu, should be derived from location
        
        if (!groupedByState[pos]) {
            groupedByState[pos] = {
                pos: pos, // Place of supply
                inv: []
            };
        }

        groupedByState[pos].inv.push({
            inum: row.bill_no,
            idt: formatDate(row.invoice_date),
            val: parseFloat(row.invoice_value || 0).toFixed(2),
            itms: [{
                num: 1,
                itm_det: {
                    rt: parseFloat(row.cgst_percent || 0) + parseFloat(row.sgst_percent || 0),
                    txval: parseFloat(row.taxable_value || 0).toFixed(2),
                    iamt: parseFloat(row.igst_amount || 0).toFixed(2),
                    camt: parseFloat(row.cgst_amount || 0).toFixed(2),
                    samt: parseFloat(row.sgst_amount || 0).toFixed(2),
                    csamt: 0
                }
            }]
        });
    });

    return Object.values(groupedByState);
}

/**
 * Format B2CS data for GSTR-1
 */
function formatB2CSData(b2csData, gstin) {
    if (!b2csData || b2csData.length === 0) return [];

    const stateCode = gstin.substring(0, 2); // Get state code from GSTIN

    return b2csData.map(row => ({
        sply_ty: "INTRA", // Type of supply: INTRA or INTER
        pos: stateCode, // Place of supply
        typ: "OE", // Type: OE=Others, E=Ecommerce
        rt: parseFloat(row.tax_rate || 0).toFixed(2), // Tax rate
        txval: parseFloat(row.taxable_value || 0).toFixed(2),
        iamt: parseFloat(row.igst_amount || 0).toFixed(2),
        camt: parseFloat(row.cgst_amount || 0).toFixed(2),
        samt: parseFloat(row.sgst_amount || 0).toFixed(2),
        csamt: 0
    }));
}

/**
 * Format HSN data for GSTR-1
 */
function formatHSNData(hsnData) {
    if (!hsnData || hsnData.length === 0) return { data: [] };

    return {
        data: hsnData.map((row, index) => ({
            num: index + 1,
            hsn_sc: row.hsn_code || "", // HSN code
            desc: row.product_name || "", // Description
            uqc: getUQCCode(row.uqc), // Unit Quantity Code
            qty: parseFloat(row.total_quantity || 0).toFixed(2),
            val: parseFloat(row.total_taxable_value || 0).toFixed(2),
            txval: parseFloat(row.total_taxable_value || 0).toFixed(2),
            iamt: parseFloat(row.total_igst || 0).toFixed(2),
            camt: parseFloat(row.total_cgst || 0).toFixed(2),
            samt: parseFloat(row.total_sgst || 0).toFixed(2),
            csamt: 0
        }))
    };
}

/**
 * Generate document summary
 */
function generateDocumentSummary(b2bData, b2clData, b2csData) {
    const totalInvoices = b2bData.length + b2clData.length;
    
    return {
        doc_det: [{
            doc_num: 1, // Document serial number from
            docs: [{
                num: 1,
                from: "1", // Starting serial number
                to: totalInvoices.toString(), // Ending serial number
                totnum: totalInvoices, // Total number of documents
                cancel: 0, // Number of cancelled documents
                net_issue: totalInvoices // Net documents issued
            }]
        }]
    };
}

/**
 * Calculate grand total
 */
function calculateGrandTotal(b2bData, b2clData, b2csData) {
    let total = 0;

    b2bData.forEach(row => {
        total += parseFloat(row.invoice_value || 0);
    });

    b2clData.forEach(row => {
        total += parseFloat(row.invoice_value || 0);
    });

    b2csData.forEach(row => {
        const invoiceValue = parseFloat(row.taxable_value || 0) + 
                           parseFloat(row.cgst_amount || 0) + 
                           parseFloat(row.sgst_amount || 0);
        total += invoiceValue;
    });

    return parseFloat(total).toFixed(2);
}

/**
 * Format date to DD-MM-YYYY
 */
function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Get UQC (Unit Quantity Code) from unit name
 */
function getUQCCode(unit) {
    const uqcMap = {
        'LITERS': 'LTR',
        'LITRES': 'LTR',
        'LTR': 'LTR',
        'KG': 'KGS',
        'KILOGRAMS': 'KGS',
        'GRAMS': 'GMS',
        'NOS': 'NOS',
        'PIECES': 'PCS',
        'PCS': 'PCS',
        'BOTTLES': 'BTL',
        'CANS': 'CAN',
        'UNITS': 'UNT'
    };

    return uqcMap[unit?.toUpperCase()] || 'OTH';
}