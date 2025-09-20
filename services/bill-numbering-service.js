// services/bill-numbering-service.js
const locationConfigDao = require('../dao/location-config-dao');
const db = require('../db/db-connection');
const Sequelize = require('sequelize');

const BillNumberingService = {
    
    // Get current financial year dates (April 1st to March 31st)
    getCurrentFinancialYear: (date = new Date()) => {
        const currentYear = date.getFullYear();
        const currentMonth = date.getMonth();
        
        let fromDate, toDate, fyYear;
        
        // Financial year starts from April 1st
        if (currentMonth >= 3) { // April (3) to December
            fromDate = new Date(currentYear, 3, 1); // April 1st of current year
            toDate = new Date(currentYear + 1, 2, 31); // March 31st of next year
            fyYear = currentYear;
        } else { // January to March
            fromDate = new Date(currentYear - 1, 3, 1); // April 1st of previous year
            toDate = new Date(currentYear, 2, 31); // March 31st of current year
            fyYear = currentYear - 1;
        }
        
        return {
            fromDate,
            toDate,
            fyYear,
            fyString: `FY${fyYear}-${(fyYear + 1).toString().slice(-2)}` // e.g., "FY2024-25"
        };
    },

    // Get bill numbering configuration for a location
    getBillNumberConfig: async (locationCode) => {
        try {
            const config = {
                creditPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_PREFIX_CREDIT') || 'CR/',
                cashPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_PREFIX_CASH') || 'CS/',
                padding: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_NUMBER_PADDING') || '6'),
                resetFrequency: await locationConfigDao.getSetting(locationCode, 'BILL_RESET_FREQUENCY') || 'FINANCIAL_YEAR',
                includeYearInNumber: await locationConfigDao.getSetting(locationCode, 'BILL_INCLUDE_YEAR') || 'false',
                yearFormat: await locationConfigDao.getSetting(locationCode, 'BILL_YEAR_FORMAT') || 'YY', // YY or YYYY
                // Migration support - starting numbers from old system
                creditStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_CREDIT_START_NUMBER') || '0'),
                cashStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_CASH_START_NUMBER') || '0'),
                // Unified sequence support
                useUnifiedSequence: await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_SEQUENCE') || 'false',
                unifiedPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_PREFIX') || 'INV/',
                unifiedStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_START_NUMBER') || '0')
            };
            
            return config;
        } catch (error) {
            console.error('Error getting bill number config:', error);
            // Return default configuration
            return {
                creditPrefix: 'CR/',
                cashPrefix: 'CS/',
                padding: 6,
                resetFrequency: 'FINANCIAL_YEAR',
                includeYearInNumber: 'false',
                yearFormat: 'YY',
                creditStartingNumber: 0,
                cashStartingNumber: 0,
                useUnifiedSequence: 'false',
                unifiedPrefix: 'INV/',
                unifiedStartingNumber: 0
            };
        }
    },

    // Get maximum bill number for current financial year
    getMaxBillNumberForPeriod: async (locationCode, billType, config) => {
        try {
            let prefix, startingNumber;
            
            // Check if unified sequence is enabled
            if (config.useUnifiedSequence === 'true') {
                prefix = config.unifiedPrefix;
                startingNumber = config.unifiedStartingNumber;
            } else {
                prefix = billType === 'CREDIT' ? config.creditPrefix : config.cashPrefix;
                startingNumber = billType === 'CREDIT' ? config.creditStartingNumber : config.cashStartingNumber;
            }
            
            let whereClause = 'location_code = :locationCode AND bill_no LIKE :prefix';
            let replacements = { 
                locationCode: locationCode,
                prefix: `${prefix}%`
            };

            // If unified sequence, look at ALL bill types, not just the current type
            if (config.useUnifiedSequence === 'false') {
                // For separate sequences, only look at bills of the same type
                whereClause += ' AND bill_type = :billType';
                replacements.billType = billType;
            }

            // If reset frequency is FINANCIAL_YEAR, filter by current financial year
            if (config.resetFrequency === 'FINANCIAL_YEAR') {
                const fy = BillNumberingService.getCurrentFinancialYear();
                whereClause += ' AND creation_date >= :fyStart AND creation_date <= :fyEnd';
                replacements.fyStart = fy.fromDate;
                replacements.fyEnd = fy.toDate;
            }

            const query = `
                SELECT COALESCE(MAX(CAST(
                    CASE 
                        WHEN bill_no REGEXP '^${prefix.replace('/', '\\/')}[0-9]+$' THEN 
                            SUBSTRING(bill_no, ${prefix.length + 1})
                        ELSE '0'
                    END AS UNSIGNED)), 0) as max_bill 
                FROM t_bills 
                WHERE ${whereClause}
            `;

            const result = await db.sequelize.query(query, {
                replacements: replacements,
                type: Sequelize.QueryTypes.SELECT
            });

            // Use the higher of database max or configured starting number
            const dbMaxNumber = result[0].max_bill || 0;
            return Math.max(dbMaxNumber, startingNumber);
            
        } catch (error) {
            console.error('Error getting max bill number:', error);
            return 0;
        }
    },

    // Generate next bill number based on configuration
    generateNextBillNumber: async (locationCode, billType) => {
        try {
            const config = await BillNumberingService.getBillNumberConfig(locationCode);
            const maxNumber = await BillNumberingService.getMaxBillNumberForPeriod(locationCode, billType, config);
            
            let prefix;
            
            // Determine prefix based on unified sequence setting
            if (config.useUnifiedSequence === 'true') {
                prefix = config.unifiedPrefix;
            } else {
                prefix = billType === 'CREDIT' ? config.creditPrefix : config.cashPrefix;
            }
            
            const nextNumber = maxNumber + 1;
            let billNumber = '';
            
            // Build bill number based on configuration
            if (config.includeYearInNumber === 'true') {
                const fy = BillNumberingService.getCurrentFinancialYear();
                const yearPart = config.yearFormat === 'YYYY' ? 
                    fy.fyYear.toString() : 
                    fy.fyYear.toString().slice(-2);
                
                const paddedNumber = String(nextNumber).padStart(config.padding, '0');
                billNumber = `${prefix}${yearPart}${paddedNumber}`;
            } else {
                const paddedNumber = String(nextNumber).padStart(config.padding, '0');
                billNumber = `${prefix}${paddedNumber}`;
            }
            
            return billNumber;
        } catch (error) {
            console.error('Error generating bill number:', error);
            // Fallback to current logic
            const prefix = billType === 'CREDIT' ? 'CR/' : 'CS/';
            return `${prefix}000001`;
        }
    },

    // Set default configuration for a location
    setDefaultConfig: async (locationCode, createdBy = 'system') => {
        try {
            const defaultSettings = [
                { name: 'BILL_PREFIX_CREDIT', value: 'CR/' },
                { name: 'BILL_PREFIX_CASH', value: 'CS/' },
                { name: 'BILL_NUMBER_PADDING', value: '6' },
                { name: 'BILL_RESET_FREQUENCY', value: 'FINANCIAL_YEAR' },
                { name: 'BILL_INCLUDE_YEAR', value: 'false' },
                { name: 'BILL_YEAR_FORMAT', value: 'YY' },
                { name: 'BILL_CREDIT_START_NUMBER', value: '0' },
                { name: 'BILL_CASH_START_NUMBER', value: '0' },
                // Unified sequence defaults
                { name: 'BILL_UNIFIED_SEQUENCE', value: 'false' },
                { name: 'BILL_UNIFIED_PREFIX', value: 'INV/' },
                { name: 'BILL_UNIFIED_START_NUMBER', value: '0' }
            ];

            for (const setting of defaultSettings) {
                await locationConfigDao.setSetting(
                    locationCode, 
                    setting.name, 
                    setting.value, 
                    createdBy
                );
            }

            return true;
        } catch (error) {
            console.error('Error setting default config:', error);
            return false;
        }
    },

    // Migration helper - set starting numbers from old system
    setMigrationStartingNumbers: async (locationCode, creditStartNumber, cashStartNumber, createdBy = 'migration') => {
        try {
            await locationConfigDao.setSetting(
                locationCode, 
                'BILL_CREDIT_START_NUMBER', 
                creditStartNumber.toString(), 
                createdBy
            );
            
            await locationConfigDao.setSetting(
                locationCode, 
                'BILL_CASH_START_NUMBER', 
                cashStartNumber.toString(), 
                createdBy
            );

            return true;
        } catch (error) {
            console.error('Error setting migration starting numbers:', error);
            return false;
        }
    },

    // Helper to enable unified sequence for a location
    enableUnifiedSequence: async (locationCode, unifiedPrefix = 'INV/', startingNumber = 0, createdBy = 'admin') => {
        try {
            await locationConfigDao.setSetting(
                locationCode, 
                'BILL_UNIFIED_SEQUENCE', 
                'true', 
                createdBy
            );
            
            await locationConfigDao.setSetting(
                locationCode, 
                'BILL_UNIFIED_PREFIX', 
                unifiedPrefix, 
                createdBy
            );
            
            if (startingNumber > 0) {
                await locationConfigDao.setSetting(
                    locationCode, 
                    'BILL_UNIFIED_START_NUMBER', 
                    startingNumber.toString(), 
                    createdBy
                );
            }

            return true;
        } catch (error) {
            console.error('Error enabling unified sequence:', error);
            return false;
        }
    },

    // Set global default configuration (location_code = '*')
    setGlobalDefaults: async (createdBy = 'system') => {
        return await BillNumberingService.setDefaultConfig('*', createdBy);
    },

    // Helper to get current configuration for debugging
    getConfigSummary: async (locationCode) => {
        const config = await BillNumberingService.getBillNumberConfig(locationCode);
        const fy = BillNumberingService.getCurrentFinancialYear();
        
        return {
            locationCode,
            currentFinancialYear: fy.fyString,
            configuration: config,
            sampleNumbers: {
                nextCredit: await BillNumberingService.generateNextBillNumber(locationCode, 'CREDIT'),
                nextCash: await BillNumberingService.generateNextBillNumber(locationCode, 'CASH')
            }
        };
    }
};

module.exports = BillNumberingService;