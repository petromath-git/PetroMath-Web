const db = require("../db/db-connection");
const GstReturnData = db.gst_return_data;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    /**
     * Find return by ID
     */
    findById: async (returnDataId) => {
        return await GstReturnData.findByPk(returnDataId);
    },

    /**
     * Find returns by location and period
     */
    findByLocationAndPeriod: async (locationCode, returnType, returnPeriod) => {
        return await GstReturnData.findOne({
            where: {
                location_code: locationCode,
                return_type: returnType,
                return_period: returnPeriod
            }
        });
    },

    /**
     * Find all returns for a location
     */
    findByLocation: async (locationCode, returnType = null, limit = 50) => {
        const whereClause = { location_code: locationCode };
        
        if (returnType) {
            whereClause.return_type = returnType;
        }

        return await GstReturnData.findAll({
            where: whereClause,
            order: [['return_period', 'DESC']],
            limit: limit
        });
    },

    /**
     * Find returns by status
     */
    findByStatus: async (locationCode, status) => {
        return await GstReturnData.findAll({
            where: {
                location_code: locationCode,
                status: status
            },
            order: [['return_period', 'DESC']]
        });
    },

    /**
     * Find returns by date range
     */
    findByDateRange: async (locationCode, fromDate, toDate, returnType = null) => {
        const whereClause = {
            location_code: locationCode,
            from_date: { [Op.gte]: fromDate },
            to_date: { [Op.lte]: toDate }
        };

        if (returnType) {
            whereClause.return_type = returnType;
        }

        return await GstReturnData.findAll({
            where: whereClause,
            order: [['from_date', 'DESC']]
        });
    },

    /**
     * Create new return data
     */
    create: async (returnData) => {
        return await GstReturnData.create(returnData);
    },

    /**
     * Update return data
     */
    update: async (returnDataId, updateData) => {
        return await GstReturnData.update(updateData, {
            where: { return_data_id: returnDataId }
        });
    },

    /**
     * Update return status
     */
    updateStatus: async (returnDataId, status, notes = null) => {
        const updateData = { 
            status: status,
            updation_date: new Date()
        };
        
        if (notes) {
            updateData.notes = notes;
        }

        return await GstReturnData.update(updateData, {
            where: { return_data_id: returnDataId }
        });
    },

    /**
     * Check if return exists for period
     */
    exists: async (locationCode, returnType, returnPeriod) => {
        const count = await GstReturnData.count({
            where: {
                location_code: locationCode,
                return_type: returnType,
                return_period: returnPeriod
            }
        });
        return count > 0;
    },

    /**
     * Get pending returns (DRAFT or READY status)
     */
    findPendingReturns: async (locationCode = null) => {
        const whereClause = {
            status: { [Op.in]: ['DRAFT', 'READY'] }
        };

        if (locationCode) {
            whereClause.location_code = locationCode;
        }

        return await GstReturnData.findAll({
            where: whereClause,
            order: [['return_period', 'DESC']]
        });
    },

    /**
     * Delete return (soft delete by setting status to CANCELLED)
     */
    cancel: async (returnDataId, reason = null) => {
        return await GstReturnData.update({
            status: 'CANCELLED',
            notes: reason,
            updation_date: new Date()
        }, {
            where: { return_data_id: returnDataId }
        });
    },

    /**
     * Get summary statistics
     */
    getSummaryStats: async (locationCode, financialYear = null) => {
        const whereClause = { location_code: locationCode };
        
        if (financialYear) {
            whereClause.financial_year = financialYear;
        }

        return await GstReturnData.findAll({
            attributes: [
                'return_type',
                'status',
                [Sequelize.fn('COUNT', Sequelize.col('return_data_id')), 'count'],
                [Sequelize.fn('SUM', Sequelize.col('total_taxable_value')), 'total_taxable'],
                [Sequelize.fn('SUM', Sequelize.col('total_cgst')), 'total_cgst'],
                [Sequelize.fn('SUM', Sequelize.col('total_sgst')), 'total_sgst'],
                [Sequelize.fn('SUM', Sequelize.col('total_igst')), 'total_igst']
            ],
            where: whereClause,
            group: ['return_type', 'status']
        });
    }
};