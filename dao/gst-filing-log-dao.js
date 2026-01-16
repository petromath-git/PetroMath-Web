const db = require("../db/db-connection");
const GstFilingLog = db.gst_filing_log;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    /**
     * Create new filing log entry
     */
    create: async (logData) => {
        return await GstFilingLog.create(logData);
    },

    /**
     * Find logs by return data ID
     */
    findByReturnDataId: async (returnDataId) => {
        return await GstFilingLog.findAll({
            where: { return_data_id: returnDataId },
            order: [['creation_date', 'DESC']]
        });
    },

    /**
     * Find logs by location
     */
    findByLocation: async (locationCode, limit = 100) => {
        return await GstFilingLog.findAll({
            where: { location_code: locationCode },
            order: [['creation_date', 'DESC']],
            limit: limit
        });
    },

    /**
     * Find logs by date range
     */
    findByDateRange: async (locationCode, fromDate, toDate) => {
        return await GstFilingLog.findAll({
            where: {
                location_code: locationCode,
                creation_date: {
                    [Op.gte]: fromDate,
                    [Op.lte]: toDate
                }
            },
            order: [['creation_date', 'DESC']]
        });
    },

    /**
     * Find logs by action type
     */
    findByActionType: async (locationCode, actionType, limit = 50) => {
        return await GstFilingLog.findAll({
            where: {
                location_code: locationCode,
                action_type: actionType
            },
            order: [['creation_date', 'DESC']],
            limit: limit
        });
    },

    /**
     * Find failed logs
     */
    findFailedLogs: async (locationCode = null, limit = 50) => {
        const whereClause = { status: 'FAILED' };
        
        if (locationCode) {
            whereClause.location_code = locationCode;
        }

        return await GstFilingLog.findAll({
            where: whereClause,
            order: [['creation_date', 'DESC']],
            limit: limit
        });
    },

    /**
     * Get latest log for a return
     */
    getLatestLog: async (returnDataId) => {
        return await GstFilingLog.findOne({
            where: { return_data_id: returnDataId },
            order: [['creation_date', 'DESC']]
        });
    },

    /**
     * Get logs with error messages
     */
    findLogsWithErrors: async (locationCode, days = 7) => {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        return await GstFilingLog.findAll({
            where: {
                location_code: locationCode,
                status: 'FAILED',
                error_message: { [Op.ne]: null },
                creation_date: { [Op.gte]: dateFrom }
            },
            order: [['creation_date', 'DESC']]
        });
    },

    /**
     * Get API call statistics
     */
    getApiStats: async (locationCode, fromDate = null, toDate = null) => {
        const whereClause = { location_code: locationCode };
        
        if (fromDate && toDate) {
            whereClause.creation_date = {
                [Op.gte]: fromDate,
                [Op.lte]: toDate
            };
        }

        return await GstFilingLog.findAll({
            attributes: [
                'action_type',
                'status',
                [Sequelize.fn('COUNT', Sequelize.col('filing_log_id')), 'count'],
                [Sequelize.fn('AVG', Sequelize.col('status_code')), 'avg_status_code']
            ],
            where: whereClause,
            group: ['action_type', 'status']
        });
    },

    /**
     * Check if filing was successful for a return
     */
    hasSuccessfulFiling: async (returnDataId) => {
        const count = await GstFilingLog.count({
            where: {
                return_data_id: returnDataId,
                action_type: 'FILE',
                status: 'SUCCESS'
            }
        });
        return count > 0;
    }
};