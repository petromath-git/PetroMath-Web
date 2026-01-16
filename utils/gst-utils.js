const moment = require('moment');

module.exports = {
    /**
     * Validate GSTIN format
     */
    isValidGstin: (gstin) => {
        if (!gstin || gstin.length !== 15) return false;
        
        // GSTIN format: 2 digits state code + 10 digit PAN + 1 digit entity + 1 digit Z + 1 check digit
        const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        return gstinRegex.test(gstin);
    },

    /**
     * Get return period from date (format: MMYYYY)
     */
    getReturnPeriod: (date) => {
        return moment(date).format('MMYYYY');
    },

    /**
     * Get financial year from date (format: 2024-25)
     */
    getFinancialYear: (date) => {
        const momentDate = moment(date);
        const year = momentDate.year();
        const month = momentDate.month() + 1; // moment months are 0-indexed
        
        if (month >= 4) {
            // April onwards = current FY
            return `${year}-${(year + 1).toString().slice(-2)}`;
        } else {
            // Jan-March = previous FY
            return `${year - 1}-${year.toString().slice(-2)}`;
        }
    },

    /**
     * Get period dates for a given return period
     */
    getPeriodDates: (returnPeriod) => {
        // returnPeriod format: MMYYYY (e.g., "012025" for Jan 2025)
        const month = returnPeriod.substring(0, 2);
        const year = returnPeriod.substring(2, 6);
        
        const fromDate = moment(`${year}-${month}-01`, 'YYYY-MM-DD');
        const toDate = fromDate.clone().endOf('month');
        
        return {
            from_date: fromDate.format('YYYY-MM-DD'),
            to_date: toDate.format('YYYY-MM-DD'),
            financial_year: module.exports.getFinancialYear(fromDate.toDate())
        };
    },

    /**
     * Calculate IGST from CGST + SGST
     */
    calculateIgst: (cgst, sgst) => {
        return parseFloat(cgst || 0) + parseFloat(sgst || 0);
    },

    /**
     * Determine if transaction is inter-state (IGST) or intra-state (CGST+SGST)
     */
    isInterState: (supplierGstin, recipientGstin) => {
        if (!supplierGstin || !recipientGstin) return false;
        
        // Compare first 2 digits (state code)
        return supplierGstin.substring(0, 2) !== recipientGstin.substring(0, 2);
    },

    /**
     * Get state code from GSTIN
     */
    getStateCodeFromGstin: (gstin) => {
        if (!gstin || gstin.length < 2) return null;
        return gstin.substring(0, 2);
    },

    /**
     * Format amount for GST (2 decimals)
     */
    formatGstAmount: (amount) => {
        return parseFloat(parseFloat(amount || 0).toFixed(2));
    },

    /**
     * Round GST amount as per GST rules
     */
    roundGstAmount: (amount) => {
        // GST rounding: Round to nearest rupee
        return Math.round(parseFloat(amount || 0));
    },

    /**
     * Validate return period format
     */
    isValidReturnPeriod: (returnPeriod) => {
        if (!returnPeriod || returnPeriod.length !== 6) return false;
        
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2, 6));
        
        return month >= 1 && month <= 12 && year >= 2017 && year <= 2099;
    },

    /**
     * Get previous return period
     */
    getPreviousReturnPeriod: (returnPeriod) => {
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2, 6));
        
        let prevMonth = month - 1;
        let prevYear = year;
        
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = year - 1;
        }
        
        return `${prevMonth.toString().padStart(2, '0')}${prevYear}`;
    },

    /**
     * Get next return period
     */
    getNextReturnPeriod: (returnPeriod) => {
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2, 6));
        
        let nextMonth = month + 1;
        let nextYear = year;
        
        if (nextMonth === 13) {
            nextMonth = 1;
            nextYear = year + 1;
        }
        
        return `${nextMonth.toString().padStart(2, '0')}${nextYear}`;
    },

    /**
     * Parse return period to readable format
     */
    formatReturnPeriod: (returnPeriod) => {
        const month = returnPeriod.substring(0, 2);
        const year = returnPeriod.substring(2, 6);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        return `${monthNames[parseInt(month) - 1]} ${year}`;
    },

    /**
     * Get HSN code summary key (first 4 or 6 digits based on turnover)
     */
    getHsnSummaryKey: (hsnCode, annualTurnover) => {
        if (!hsnCode) return 'UNCLASSIFIED';
        
        // Remove any non-numeric characters
        const cleanHsn = hsnCode.replace(/[^0-9]/g, '');
        
        // For turnover > 5 crore, use 6 digits; else 4 digits
        const digits = annualTurnover > 50000000 ? 6 : 4;
        
        return cleanHsn.substring(0, Math.min(digits, cleanHsn.length)).padEnd(digits, '0');
    },

    /**
     * Classify transaction type for GSTR-1
     */
    classifyTransactionType: (customerGstin, amount) => {
        if (!customerGstin || customerGstin.trim() === '') {
            // B2C transactions
            if (amount > 250000) {
                return 'B2CL'; // B2C Large (> 2.5 lakh)
            } else {
                return 'B2CS'; // B2C Small
            }
        } else {
            // B2B transactions
            return 'B2B';
        }
    },

    /**
     * Get document type based on transaction
     */
    getDocumentType: (transactionType) => {
        const typeMap = {
            'INVOICE': 'INV',
            'DEBIT_NOTE': 'DBN',
            'CREDIT_NOTE': 'CDN',
            'REFUND': 'REFUND'
        };
        
        return typeMap[transactionType] || 'INV';
    },

    /**
     * Calculate taxable value from total (RSP inclusive)
     */
    calculateTaxableValue: (totalAmount, cgstPercent, sgstPercent) => {
        const totalTaxPercent = parseFloat(cgstPercent || 0) + parseFloat(sgstPercent || 0);
        
        if (totalTaxPercent === 0) return parseFloat(totalAmount);
        
        return parseFloat(totalAmount) / (1 + (totalTaxPercent / 100));
    },

    /**
     * Validate HSN code format
     */
    isValidHsnCode: (hsnCode) => {
        if (!hsnCode) return false;
        
        // HSN code should be 4, 6, or 8 digits
        const cleanHsn = hsnCode.replace(/[^0-9]/g, '');
        return [4, 6, 8].includes(cleanHsn.length);
    },

    /**
     * Get rate of tax (combined CGST + SGST or IGST)
     */
    getTaxRate: (cgstPercent, sgstPercent, igstPercent) => {
        if (igstPercent > 0) {
            return parseFloat(igstPercent);
        }
        return parseFloat(cgstPercent || 0) + parseFloat(sgstPercent || 0);
    },

    /**
     * Get current return period
     */
    getCurrentReturnPeriod: () => {
        return moment().subtract(1, 'month').format('MMYYYY');
    },

    /**
     * Check if due date has passed for filing
     */
    isDueDatePassed: (returnPeriod) => {
        // GSTR-1 due date: 11th of next month
        // GSTR-3B due date: 20th of next month
        
        const periodDates = module.exports.getPeriodDates(returnPeriod);
        const dueDate = moment(periodDates.to_date).add(1, 'month').date(20);
        
        return moment().isAfter(dueDate);
    }
};