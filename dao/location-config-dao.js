const db = require("../db/db-connection");
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const LocationConfig = db.location_config;

module.exports = {
    
    // Get a specific setting for a location (with fallback to global '*')
    getSetting: async (locationCode, settingName) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
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
                order: [['setting_name', 'ASC'], ['location_code', 'DESC']]
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
    },

    // NEW METHODS FOR UI

    // Get all active configs with optional location filter
    getAllConfigs: async (locationFilter = null) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
            let whereClause = {
                effective_start_date: { [Op.lte]: currentDate },
                effective_end_date: { [Op.gte]: currentDate }
            };

            // Apply location filter if provided
            if (locationFilter) {
                if (locationFilter === '*') {
                    // Only global configs
                    whereClause.location_code = '*';
                } else if (locationFilter === 'ALL') {
                    // All configs (no additional filter)
                } else {
                    // Specific location + global
                    whereClause.location_code = { [Op.in]: [locationFilter, '*'] };
                }
            }
            
            const configs = await LocationConfig.findAll({
                where: whereClause,
                order: [
                    ['location_code', 'ASC'],
                    ['setting_name', 'ASC'],
                    ['effective_start_date', 'DESC']
                ],
                raw: true
            });
            
            return configs;
        } catch (error) {
            console.error('Error in getAllConfigs:', error);
            throw error;
        }
    },

    // Get history/expired configs
    getHistoryConfigs: async (locationFilter = null) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
            let whereClause = {
                effective_end_date: { [Op.lt]: currentDate }
            };

            // Apply location filter if provided
            if (locationFilter) {
                if (locationFilter === '*') {
                    whereClause.location_code = '*';
                } else if (locationFilter !== 'ALL') {
                    whereClause.location_code = { [Op.in]: [locationFilter, '*'] };
                }
            }
            
            const configs = await LocationConfig.findAll({
                where: whereClause,
                order: [
                    ['location_code', 'ASC'],
                    ['setting_name', 'ASC'],
                    ['effective_end_date', 'DESC']
                ],
                raw: true
            });
            
            return configs;
        } catch (error) {
            console.error('Error in getHistoryConfigs:', error);
            throw error;
        }
    },

    // Check if duplicate setting exists for location (among active configs)
    checkDuplicateSetting: async (locationCode, settingName, excludeConfigId = null) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0];
            
            let whereClause = {
                location_code: locationCode,
                setting_name: settingName,
                effective_start_date: { [Op.lte]: currentDate },
                effective_end_date: { [Op.gte]: currentDate }
            };

            // Exclude specific config_id (useful when updating)
            if (excludeConfigId) {
                whereClause.config_id = { [Op.ne]: excludeConfigId };
            }
            
            const existingConfig = await LocationConfig.findOne({
                where: whereClause
            });
            
            return existingConfig !== null;
        } catch (error) {
            console.error('Error in checkDuplicateSetting:', error);
            throw error;
        }
    },

    // Create new config with validation
    createConfig: async (configData) => {
        try {
            const { location_code, setting_name, setting_value, effective_start_date, created_by } = configData;
            
            // Check for duplicate
            const isDuplicate = await module.exports.checkDuplicateSetting(location_code, setting_name);
            
            if (isDuplicate) {
                throw new Error(`Setting '${setting_name}' already exists for location '${location_code}'`);
            }
            
            // Create new config
            const newConfig = await LocationConfig.create({
                location_code: location_code,
                setting_name: setting_name,
                setting_value: setting_value,
                effective_start_date: effective_start_date || new Date().toISOString().split('T')[0],
                effective_end_date: '9999-12-31',
                created_by: created_by || 'system',
                updated_by: created_by || 'system',
                creation_date: new Date(),
                updation_date: new Date()
            });
            
            return newConfig;
        } catch (error) {
            console.error('Error in createConfig:', error);
            throw error;
        }
    },

    // Update config (end-date old, create new)
    updateConfig: async (configId, newSettingValue, updatedBy = 'system') => {
        try {
            // Get existing config
            const existingConfig = await LocationConfig.findByPk(configId);
            
            if (!existingConfig) {
                throw new Error('Config not found');
            }

            // Check if it's still active
            const currentDate = new Date().toISOString().split('T')[0];
            if (existingConfig.effective_end_date < currentDate) {
                throw new Error('Cannot update expired config');
            }

            // End-date the existing config (set end date to yesterday)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const endDate = yesterday.toISOString().split('T')[0];
            
            await LocationConfig.update(
                { 
                    effective_end_date: endDate,
                    updated_by: updatedBy,
                    updation_date: new Date()
                },
                {
                    where: { config_id: configId }
                }
            );
            
            // Create new config with updated value
            const newConfig = await LocationConfig.create({
                location_code: existingConfig.location_code,
                setting_name: existingConfig.setting_name,
                setting_value: newSettingValue,
                effective_start_date: currentDate,
                effective_end_date: '9999-12-31',
                created_by: updatedBy,
                updated_by: updatedBy,
                creation_date: new Date(),
                updation_date: new Date()
            });
            
            return newConfig;
        } catch (error) {
            console.error('Error in updateConfig:', error);
            throw error;
        }
    },

    // Get config by ID
    getConfigById: async (configId) => {
        try {
            const config = await LocationConfig.findByPk(configId, { raw: true });
            return config;
        } catch (error) {
            console.error('Error in getConfigById:', error);
            throw error;
        }
    },

    // Get all unique setting names (for autocomplete/suggestions)
    getAllSettingNames: async () => {
        try {
            const settings = await LocationConfig.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('setting_name')), 'setting_name']],
                order: [['setting_name', 'ASC']],
                raw: true
            });
            
            return settings.map(s => s.setting_name);
        } catch (error) {
            console.error('Error in getAllSettingNames:', error);
            throw error;
        }
    }
};