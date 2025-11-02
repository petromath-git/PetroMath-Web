// services/bill-numbering-service.js
const locationConfigDao = require('../dao/location-config-dao');
const db = require('../db/db-connection');
const Sequelize = require('sequelize');

const BillNumberingService = {

    getCurrentFinancialYear: (date = new Date()) => {
        const currentYear = date.getFullYear();
        const currentMonth = date.getMonth();

        let fromDate, toDate, fyYear;

        if (currentMonth >= 3) {
            fromDate = new Date(currentYear, 3, 1);
            toDate = new Date(currentYear + 1, 2, 31);
            fyYear = currentYear;
        } else {
            fromDate = new Date(currentYear - 1, 3, 1);
            toDate = new Date(currentYear, 2, 31);
            fyYear = currentYear - 1;
        }

        return {
            fromDate,
            toDate,
            fyYear,
            fyString: `FY${fyYear}-${(fyYear + 1).toString().slice(-2)}`
        };
    },

    getBillNumberConfig: async (locationCode) => {
        try {
            const config = {
                // Prefix and Suffix
                creditPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_PREFIX_CREDIT') || '',
                cashPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_PREFIX_CASH') || '',
                creditSuffix: await locationConfigDao.getSetting(locationCode, 'BILL_SUFFIX_CREDIT') || '',
                cashSuffix: await locationConfigDao.getSetting(locationCode, 'BILL_SUFFIX_CASH') || '',
                
                // Number formatting
                padding: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_NUMBER_PADDING') || '6'),
                resetFrequency: await locationConfigDao.getSetting(locationCode, 'BILL_RESET_FREQUENCY') || 'FINANCIAL_YEAR',
                includeYearInNumber: await locationConfigDao.getSetting(locationCode, 'BILL_INCLUDE_YEAR') || 'false',
                yearFormat: await locationConfigDao.getSetting(locationCode, 'BILL_YEAR_FORMAT') || 'YY',

                // Starting numbers
                creditStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_CREDIT_START_NUMBER') || '0'),
                cashStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_CASH_START_NUMBER') || '0'),

                // Unified sequence support
                useUnifiedSequence: await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_SEQUENCE') || 'false',
                unifiedPrefix: await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_PREFIX') || '',
                unifiedSuffix: await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_SUFFIX') || '',
                unifiedStartingNumber: parseInt(await locationConfigDao.getSetting(locationCode, 'BILL_UNIFIED_START_NUMBER') || '0')
            };
            return config;
        } catch (error) {
            console.error('Error getting bill number config:', error);
            return {
                creditPrefix: '',
                cashPrefix: '',
                creditSuffix: '',
                cashSuffix: '',
                padding: 6,
                resetFrequency: 'FINANCIAL_YEAR',
                includeYearInNumber: 'false',
                yearFormat: 'YY',
                creditStartingNumber: 0,
                cashStartingNumber: 0,
                useUnifiedSequence: 'false',
                unifiedPrefix: '',
                unifiedSuffix: '',
                unifiedStartingNumber: 0
            };
        }
    },

    getMaxBillNumberForPeriod: async (locationCode, billType, config) => {
        try {
            let prefix, suffix, startingNumber;

            if (config.useUnifiedSequence === 'true') {
                prefix = config.unifiedPrefix;
                suffix = config.unifiedSuffix;
                startingNumber = config.unifiedStartingNumber;
            } else {
                prefix = billType === 'CREDIT' ? config.creditPrefix : config.cashPrefix;
                suffix = billType === 'CREDIT' ? config.creditSuffix : config.cashSuffix;
                startingNumber = billType === 'CREDIT' ? config.creditStartingNumber : config.cashStartingNumber;
            }

            // Build the LIKE pattern safely
            const likePattern = `${prefix}%${suffix}`;
            let whereClause = 'location_code = :locationCode AND bill_no LIKE :pattern';
            let replacements = { locationCode, pattern: likePattern };

            if (config.useUnifiedSequence === 'false') {
                whereClause += ' AND bill_type = :billType';
                replacements.billType = billType;
            }

            if (config.resetFrequency === 'FINANCIAL_YEAR') {
                const fy = BillNumberingService.getCurrentFinancialYear();
                whereClause += ' AND creation_date BETWEEN :fyStart AND :fyEnd';
                replacements.fyStart = fy.fromDate;
                replacements.fyEnd = fy.toDate;
            }

            const query = `
                SELECT COALESCE(MAX(CAST(
                    REGEXP_REPLACE(
                        bill_no, 
                        '^${prefix ? prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''}|${suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''}', 
                        ''
                    ) AS UNSIGNED)
                ), 0) AS max_bill
                FROM t_bills 
                WHERE ${whereClause};
            `;

            const result = await db.sequelize.query(query, {
                replacements,
                type: Sequelize.QueryTypes.SELECT
            });

            const dbMax = result[0].max_bill || 0;
            return Math.max(dbMax, startingNumber);

        } catch (error) {
            console.error('Error getting max bill number:', error);
            return 0;
        }
    },

    generateNextBillNumber: async (locationCode, billType) => {
        try {
            const config = await BillNumberingService.getBillNumberConfig(locationCode);
            const maxNumber = await BillNumberingService.getMaxBillNumberForPeriod(locationCode, billType, config);

            let prefix, suffix;
            if (config.useUnifiedSequence === 'true') {
                prefix = config.unifiedPrefix || '';
                suffix = config.unifiedSuffix || '';
            } else {
                prefix = billType === 'CREDIT' ? config.creditPrefix || '' : config.cashPrefix || '';
                suffix = billType === 'CREDIT' ? config.creditSuffix || '' : config.cashSuffix || '';
            }

            const nextNumber = maxNumber + 1;
            const paddedNumber = String(nextNumber).padStart(config.padding, '0');

            let yearPart = '';
            if (config.includeYearInNumber === 'true') {
                const fy = BillNumberingService.getCurrentFinancialYear();
                yearPart = config.yearFormat === 'YYYY' ? fy.fyYear.toString() : fy.fyYear.toString().slice(-2);
            }

            // Concatenate safely (no extra slashes)
            const billNumber = `${prefix}${yearPart}${paddedNumber}${suffix}`;
            return billNumber;

        } catch (error) {
            console.error('Error generating bill number:', error);
            const fallbackPrefix = billType === 'CREDIT' ? 'CR/' : 'CS/';
            return `${fallbackPrefix}000001`;
        }
    },

    setDefaultConfig: async (locationCode, createdBy = 'system') => {
        try {
            const defaultSettings = [
                { name: 'BILL_PREFIX_CREDIT', value: '' },
                { name: 'BILL_SUFFIX_CREDIT', value: '' },
                { name: 'BILL_PREFIX_CASH', value: '' },
                { name: 'BILL_SUFFIX_CASH', value: '' },
                { name: 'BILL_NUMBER_PADDING', value: '6' },
                { name: 'BILL_RESET_FREQUENCY', value: 'FINANCIAL_YEAR' },
                { name: 'BILL_INCLUDE_YEAR', value: 'false' },
                { name: 'BILL_YEAR_FORMAT', value: 'YY' },
                { name: 'BILL_CREDIT_START_NUMBER', value: '0' },
                { name: 'BILL_CASH_START_NUMBER', value: '0' },
                { name: 'BILL_UNIFIED_SEQUENCE', value: 'false' },
                { name: 'BILL_UNIFIED_PREFIX', value: '' },
                { name: 'BILL_UNIFIED_SUFFIX', value: '' },
                { name: 'BILL_UNIFIED_START_NUMBER', value: '0' }
            ];

            for (const setting of defaultSettings) {
                await locationConfigDao.setSetting(locationCode, setting.name, setting.value, createdBy);
            }
            return true;
        } catch (error) {
            console.error('Error setting default config:', error);
            return false;
        }
    },

    enableUnifiedSequence: async (locationCode, unifiedPrefix = '', unifiedSuffix = '', startingNumber = 0, createdBy = 'admin') => {
        try {
            await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_SEQUENCE', 'true', createdBy);
            await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_PREFIX', unifiedPrefix, createdBy);
            await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_SUFFIX', unifiedSuffix, createdBy);
            if (startingNumber > 0) {
                await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_START_NUMBER', startingNumber.toString(), createdBy);
            }
            return true;
        } catch (error) {
            console.error('Error enabling unified sequence:', error);
            return false;
        }
    },

    setGlobalDefaults: async (createdBy = 'system') => {
        return await BillNumberingService.setDefaultConfig('*', createdBy);
    },

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
