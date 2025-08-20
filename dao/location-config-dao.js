const db = require("../db/db-connection");
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const LocationConfig = db.location_config;

module.exports = {
    
    // Get a specific setting for a location (with fallback to global '*')
    getSetting: async (locationCode, settingName) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            
            // First try location-specific setting
            let config = await LocationConfig.findOne({
                where: {
                    location_code: locationCode,
                    setting_name: settingName,
                    effective_start_date: { [Op.lte]: currentDate },
                    effective_end_date: { [Op.gte]: currentDate }
                },
                order: [['effective_start_date', 'DESC']]
            });
            
            // If not found, fallback to global setting (*)
            if (!config) {
                config = await LocationConfig.findOne({
                    where: {
                        location_code: '*',
                        setting_name: settingName,
                        effective_start_date: { [Op.lte]: currentDate },
                        effective_end_date: { [Op.gte]: currentDate }
                    },
                    order: [['effective_start_date', 'DESC']]
                });
            }
            
            return config ? config.setting_value : null;
        } catch (error) {
            console.error('Error in getSetting:', error);
            throw error;
        }
    },

    // Set a setting for a location
    setSetting: async (locationCode, settingName, settingValue, createdBy = 'system') => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
            // End-date any existing active setting
            await LocationConfig.update(
                { effective_end_date: currentDate },
                {
                    where: {
                        location_code: locationCode,
                        setting_name: settingName,
                        effective_end_date: '9999-12-31'
                    }
                }
            );
            
            // Create new setting
            const newConfig = await LocationConfig.create({
                location_code: locationCode,
                setting_name: settingName,
                setting_value: settingValue,
                effective_start_date: currentDate,
                effective_end_date: '9999-12-31',
                created_by: createdBy,
                updated_by: createdBy
            });
            
            return newConfig;
        } catch (error) {
            console.error('Error in setSetting:', error);
            throw error;
        }
    },

    // Get all settings for a location (merged with global defaults)
    getAllSettings: async (locationCode) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
            // Get all active settings for this location and global (*)
            const configs = await LocationConfig.findAll({
                where: {
                    location_code: { [Op.in]: [locationCode, '*'] },
                    effective_start_date: { [Op.lte]: currentDate },
                    effective_end_date: { [Op.gte]: currentDate }
                },
                order: [['setting_name', 'ASC'], ['location_code', 'DESC']] // location-specific first, then global
            });
            
            // Build merged settings object (location-specific overrides global)
            const settings = {};
            configs.forEach(config => {
                if (!settings[config.setting_name]) {
                    settings[config.setting_name] = config.setting_value;
                }
            });
            
            return settings;
        } catch (error) {
            console.error('Error in getAllSettings:', error);
            throw error;
        }
    }
};