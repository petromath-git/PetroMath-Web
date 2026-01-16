const db = require("../db/db-connection");
const GstConfig = db.gst_config;
const { Op } = require("sequelize");

module.exports = {
    /**
     * Find GST config by location code
     */
    findByLocationCode: async (locationCode) => {
        return await GstConfig.findOne({
            where: { 
                location_code: locationCode,
                is_active: 1
            }
        });
    },

    /**
     * Find GST config by GSTIN
     */
    findByGstin: async (gstin) => {
        return await GstConfig.findOne({
            where: { 
                gstin: gstin,
                is_active: 1
            }
        });
    },

    /**
     * Get all active GST configurations
     */
    findAllActive: async () => {
        return await GstConfig.findAll({
            where: { is_active: 1 },
            order: [['location_code', 'ASC']]
        });
    },

    /**
     * Create new GST configuration
     */
    create: async (configData) => {
        return await GstConfig.create(configData);
    },

    /**
     * Update GST configuration
     */
    update: async (gstConfigId, updateData) => {
        return await GstConfig.update(updateData, {
            where: { gst_config_id: gstConfigId }
        });
    },

    /**
     * Update by location code
     */
    updateByLocationCode: async (locationCode, updateData) => {
        return await GstConfig.update(updateData, {
            where: { location_code: locationCode }
        });
    },

    /**
     * Deactivate configuration
     */
    deactivate: async (gstConfigId) => {
        return await GstConfig.update(
            { is_active: 0 },
            { where: { gst_config_id: gstConfigId } }
        );
    },

    /**
     * Check if location has GST config
     */
    hasConfig: async (locationCode) => {
        const count = await GstConfig.count({
            where: { 
                location_code: locationCode,
                is_active: 1
            }
        });
        return count > 0;
    }
};