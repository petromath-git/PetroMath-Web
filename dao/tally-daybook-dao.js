// dao/tally-daybook-dao.js
const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");
const config = require("../config/app-config");
const utils = require('../utils/app-utils');
const dateFormat = require('dateformat');

const TallyDaybookDao = {
    
    /**
     * Generate tally daybook report by calling the stored procedure
     * @param {string} fromDate - Start date for report generation
     * @param {string} toDate - End date for report generation  
     * @param {string} locationCode - Location code for filtering
     * @returns {Promise} - Promise that resolves when procedure completes
     */
    generateTallyDaybookReport: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT tally_export(:toDate, :locationCode, 'REPORT') as result`,
            {
                replacements: { 
                    toDate: toDate, 
                    locationCode: locationCode 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log('TallyDaybookDao.generateTallyDaybookReport: Procedure executed successfully');
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.generateTallyDaybookReport: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Generate report for date range by calling procedure for each date
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise} - Promise that resolves when all dates are processed
     */
    generateTallyDaybookReportForDateRange: async (fromDate, toDate, locationCode) => {
        try {
            console.log(`TallyDaybookDao.generateTallyDaybookReportForDateRange: Processing date range ${fromDate} to ${toDate}`);
            
            const startDate = new Date(fromDate);
            const endDate = new Date(toDate);
            const promises = [];
            
            // Generate report for each date in the range
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const currentDate = d.toISOString().split('T')[0];
                promises.push(TallyDaybookDao.generateTallyDaybookReport(currentDate, currentDate, locationCode));
            }
            
            await Promise.all(promises);
            console.log('TallyDaybookDao.generateTallyDaybookReportForDateRange: All dates processed successfully');
            return true;
            
        } catch (error) {
            console.error('TallyDaybookDao.generateTallyDaybookReportForDateRange: Error:', error);
            throw error;
        }
    },
    
    /**
     * Fetch the generated tally daybook report data
     * @param {string} fromDate - Start date for data retrieval
     * @param {string} toDate - End date for data retrieval
     * @param {string} locationCode - Location code for filtering
     * @returns {Promise<Array>} - Promise that resolves to array of report records
     */
    getTallyDaybookReportData: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT 
                DATE_FORMAT(txn_date, '%d/%m/%Y') as transaction_date,
                DATE_FORMAT(txn_date, '%Y-%m-%d') as sort_date,
                voucher_type,
                ledger_from,
                ledger_to,
                FORMAT(amount, 2) as formatted_amount,
                amount,
                COALESCE(narration, '') as narration,
                sequence_no,
                txn_date,
                temp_table_id
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            ORDER BY txn_date ASC, sequence_no ASC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log(`TallyDaybookDao.getTallyDaybookReportData: Retrieved ${results.length} records`);
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.getTallyDaybookReportData: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get summary statistics for the report
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise<Array>} - Promise that resolves to summary data
     */
    getTallyDaybookSummary: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT 
                voucher_type,
                COUNT(*) as transaction_count,
                SUM(amount) as total_amount,
                FORMAT(SUM(amount), 2) as formatted_total,
                AVG(amount) as average_amount,
                FORMAT(AVG(amount), 2) as formatted_average
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            GROUP BY voucher_type
            ORDER BY total_amount DESC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log(`TallyDaybookDao.getTallyDaybookSummary: Retrieved summary for ${results.length} voucher types`);
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.getTallyDaybookSummary: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get overall totals for the report period
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise<Object>} - Promise that resolves to totals object
     */
    getTallyDaybookTotals: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT 
                COUNT(*) as total_transactions,
                SUM(amount) as grand_total,
                FORMAT(SUM(amount), 2) as formatted_grand_total,
                MIN(txn_date) as earliest_date,
                MAX(txn_date) as latest_date,
                COUNT(DISTINCT voucher_type) as voucher_types_count,
                COUNT(DISTINCT txn_date) as unique_dates_count
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log('TallyDaybookDao.getTallyDaybookTotals: Retrieved totals successfully');
            return results.length > 0 ? results[0] : {};
        }).catch(error => {
            console.error('TallyDaybookDao.getTallyDaybookTotals: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get data filtered by voucher type
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @param {string} voucherType - Specific voucher type to filter
     * @returns {Promise<Array>} - Promise that resolves to filtered records
     */
    getTallyDaybookDataByVoucherType: (fromDate, toDate, locationCode, voucherType) => {
        return db.sequelize.query(
            `SELECT 
                DATE_FORMAT(txn_date, '%d/%m/%Y') as transaction_date,
                voucher_type,
                ledger_from,
                ledger_to,
                FORMAT(amount, 2) as formatted_amount,
                amount,
                COALESCE(narration, '') as narration,
                sequence_no
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            AND voucher_type = :voucherType
            ORDER BY txn_date ASC, sequence_no ASC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate,
                    voucherType: voucherType
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log(`TallyDaybookDao.getTallyDaybookDataByVoucherType: Retrieved ${results.length} records for voucher type: ${voucherType}`);
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.getTallyDaybookDataByVoucherType: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Clean up old temp data (optional - for maintenance)
     * @param {number} daysOld - Number of days old to clean up (default: 30)
     * @returns {Promise<number>} - Promise that resolves to number of deleted records
     */
    cleanupTallyTempData: (daysOld = 30) => {
        return db.sequelize.query(
            `DELETE FROM t_temp_tally_daybook_report 
            WHERE txn_date < DATE_SUB(CURDATE(), INTERVAL :daysOld DAY)`,
            {
                replacements: { daysOld: daysOld },
                type: db.sequelize.QueryTypes.DELETE
            }
        ).then(results => {
            const deletedCount = results[1] || 0; // Sequelize returns [results, metadata]
            console.log(`TallyDaybookDao.cleanupTallyTempData: Cleaned up ${deletedCount} old records`);
            return deletedCount;
        }).catch(error => {
            console.error('TallyDaybookDao.cleanupTallyTempData: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Check if report data exists for given date range
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise<boolean>} - Promise that resolves to true if data exists
     */
    checkReportDataExists: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT COUNT(*) as count
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            LIMIT 1`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            const exists = results.length > 0 && results[0].count > 0;
            console.log(`TallyDaybookDao.checkReportDataExists: Data exists: ${exists}`);
            return exists;
        }).catch(error => {
            console.error('TallyDaybookDao.checkReportDataExists: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get unique voucher types available in the system
     * @param {string} locationCode - Location code
     * @returns {Promise<Array>} - Promise that resolves to array of voucher types
     */
    getAvailableVoucherTypes: (locationCode) => {
        return db.sequelize.query(
            `SELECT DISTINCT voucher_type
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode
            ORDER BY voucher_type`,
            {
                replacements: { locationCode: locationCode },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            const voucherTypes = results.map(row => row.voucher_type);
            console.log(`TallyDaybookDao.getAvailableVoucherTypes: Found ${voucherTypes.length} voucher types`);
            return voucherTypes;
        }).catch(error => {
            console.error('TallyDaybookDao.getAvailableVoucherTypes: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get daily totals for chart/graph display
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise<Array>} - Promise that resolves to daily totals
     */
    getDailyTotals: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT 
                DATE_FORMAT(txn_date, '%Y-%m-%d') as date,
                DATE_FORMAT(txn_date, '%d/%m/%Y') as formatted_date,
                COUNT(*) as transaction_count,
                SUM(amount) as daily_total,
                FORMAT(SUM(amount), 2) as formatted_daily_total
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            GROUP BY txn_date
            ORDER BY txn_date ASC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log(`TallyDaybookDao.getDailyTotals: Retrieved ${results.length} daily records`);
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.getDailyTotals: Database error:', error);
            throw error;
        });
    },
    
    /**
     * Get ledger-wise summary
     * @param {string} fromDate - Start date
     * @param {string} toDate - End date
     * @param {string} locationCode - Location code
     * @returns {Promise<Array>} - Promise that resolves to ledger summary
     */
    getLedgerSummary: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT 
                ledger_from,
                ledger_to,
                COUNT(*) as transaction_count,
                SUM(amount) as total_amount,
                FORMAT(SUM(amount), 2) as formatted_total
            FROM t_temp_tally_daybook_report 
            WHERE location_code = :locationCode 
            AND txn_date BETWEEN :fromDate AND :toDate
            GROUP BY ledger_from, ledger_to
            ORDER BY total_amount DESC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate, 
                    toDate: toDate 
                },
                type: db.sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            console.log(`TallyDaybookDao.getLedgerSummary: Retrieved ${results.length} ledger combinations`);
            return results;
        }).catch(error => {
            console.error('TallyDaybookDao.getLedgerSummary: Database error:', error);
            throw error;
        });
    }
};

module.exports = TallyDaybookDao;