// controllers/location-config-controller.js

const LocationConfigDao = require('../dao/location-config-dao');
const LocationDao = require('../dao/location-dao');
const security = require('../utils/app-security');
const dateFormat = require('dateformat');

function safeDate(d, fmt) {
    if (!d) return 'N/A';
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? 'N/A' : dateFormat(parsed, fmt);
}

/**
 * Location Config Controller
 * Manages location-specific and global configuration settings
 * Accessible only to SuperUser role
 */

module.exports = {

    // ============================================================================
    // PAGE ROUTES (Pug Templates)
    // ============================================================================

    /**
     * GET /location-config
     * Main page - shows all active configs with filter options
     * SuperUser: can see all locations + global
     * PowerUser: can see their assigned locations + global
     * Other roles: can only see their own location + global
     */
    getLocationConfigPage: async (req, res, next) => {
        try {
            const userLocation = req.user.location_code;
            const locationFilter = req.query.location || 'ALL';
            const accessibleLocations = security.getAccessibleLocations(req.user); // null = unrestricted, else array
            const canFilterLocations = accessibleLocations === null || accessibleLocations.length > 1;

            // Determine actual filter based on the user's accessible locations
            let actualFilter;
            if (locationFilter === '*') {
                actualFilter = '*'; // global-only is always visible, regardless of role
            } else if (accessibleLocations === null) {
                // Unrestricted: filter by any location or see all
                actualFilter = locationFilter === 'ALL' ? null : locationFilter;
            } else if (accessibleLocations.length > 1) {
                // Assigned to a set of locations: honor the requested filter only if it's one of theirs
                actualFilter = (locationFilter === 'ALL' || !accessibleLocations.includes(locationFilter))
                    ? accessibleLocations
                    : locationFilter;
            } else {
                // Pinned to their single home location
                actualFilter = userLocation;
            }

            // Get all active locations for the filter dropdown
            const locations = accessibleLocations === null
                ? await LocationDao.findActiveLocations()
                : accessibleLocations.length > 1
                    ? await LocationDao.findActiveLocations(accessibleLocations)
                    : [{ location_code: userLocation, location_name: req.user.location_name || userLocation }];
            
            // Get active configs based on filter
            const activeConfigs = await LocationConfigDao.getAllConfigs(actualFilter);
            
            // Get history configs
            const historyConfigs = await LocationConfigDao.getHistoryConfigs(actualFilter);
            
            // Get all unique setting names for autocomplete
            const settingNames = await LocationConfigDao.getAllSettingNames();

            // Get description catalog (one row per setting_name) for the manage-descriptions UI
            const catalogMap = await LocationConfigDao.getCatalogMap();
            const settingCatalog = settingNames.map(name => ({
                setting_name: name,
                short_description: catalogMap[name]?.short_description || '',
                detailed_description: catalogMap[name]?.detailed_description || ''
            }));

            // Format dates for display
            const formattedActiveConfigs = activeConfigs.map(config => ({
                ...config,
                effective_start_date_formatted: safeDate(config.effective_start_date, 'dd-mmm-yyyy'),
                effective_end_date_formatted: safeDate(config.effective_end_date, 'dd-mmm-yyyy'),
                creation_date_formatted: safeDate(config.creation_date, 'dd-mmm-yyyy HH:MM'),
                is_global: config.location_code === '*'
            }));

            const formattedHistoryConfigs = historyConfigs.map(config => ({
                ...config,
                effective_start_date_formatted: safeDate(config.effective_start_date, 'dd-mmm-yyyy'),
                effective_end_date_formatted: safeDate(config.effective_end_date, 'dd-mmm-yyyy'),
                creation_date_formatted: safeDate(config.creation_date, 'dd-mmm-yyyy HH:MM'),
                is_global: config.location_code === '*'
            }));

            // Prepare render data (following JSON pattern for future API reusability)
            const renderData = {
                title: 'Location Configuration',
                user: req.user,
                activeConfigsData: JSON.stringify(formattedActiveConfigs),
                historyConfigsData: JSON.stringify(formattedHistoryConfigs),
                locationsData: JSON.stringify(locations),
                settingNamesData: JSON.stringify(settingNames),
                settingCatalogData: JSON.stringify(settingCatalog),
                activeConfigs: formattedActiveConfigs,
                historyConfigs: formattedHistoryConfigs,
                locations: locations,
                settingNames: settingNames,
                settingCatalog: settingCatalog,
                currentFilter: locationFilter,
                currentDate: new Date().toISOString().split('T')[0],
                canFilterLocations: canFilterLocations,
                messages: req.flash()
            };

            res.render('location-config', renderData);
        } catch (error) {
            console.error('Error in getLocationConfigPage:', error);
            req.flash('error', 'Failed to load location configurations');
            res.redirect('/home');
        }
    },

    // ============================================================================
    // API ROUTES (JSON Responses)
    // ============================================================================

    /**
     * POST /location-config/create
     * Create a new configuration setting
     * SuperUser: Can create for any location
     * Other roles: Can only create for their own location
     */
    createConfig: async (req, res, next) => {
        try {
            const { location_code, setting_name, setting_value, effective_start_date } = req.body;
            const username = req.user.username;

            // Validation
            if (!location_code || !setting_name || !setting_value) {
                return res.status(400).json({
                    success: false,
                    error: 'Location code, setting name, and setting value are required'
                });
            }

            // Trim inputs
            const cleanLocationCode = location_code.trim();
            const cleanSettingName = setting_name.trim().toUpperCase();
            const cleanSettingValue = setting_value.trim();

            // Security check: can only create for an accessible location or global
            if (cleanLocationCode !== '*' && !security.canAccessLocation(req.user, cleanLocationCode)) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only create configurations for your assigned location(s) or global settings'
                });
            }

            // Create config
            const newConfig = await LocationConfigDao.createConfig({
                location_code: cleanLocationCode,
                setting_name: cleanSettingName,
                setting_value: cleanSettingValue,
                effective_start_date: effective_start_date || new Date().toISOString().split('T')[0],
                created_by: username
            });

            res.json({
                success: true,
                message: 'Configuration created successfully',
                data: newConfig
            });

        } catch (error) {
            console.error('Error creating config:', error);
            
            // Check if it's a duplicate error
            if (error.message && error.message.includes('already exists')) {
                return res.status(409).json({
                    success: false,
                    error: error.message
                });
            }
            
            res.status(500).json({
                success: false,
                error: 'Failed to create configuration: ' + error.message
            });
        }
    },

    /**
     * PUT /location-config/update/:configId
     * Update existing config (end-dates old, creates new)
     * SuperUser: Can update any location's config
     * Other roles: Can only update their own location's config
     */
    updateConfig: async (req, res, next) => {
        try {
            const configId = req.params.configId;
            const { setting_value } = req.body;
            const username = req.user.username;

            // Validation
            if (!setting_value) {
                return res.status(400).json({
                    success: false,
                    error: 'Setting value is required'
                });
            }

            // Get existing config to check location
            const existingConfig = await LocationConfigDao.getConfigById(configId);

            if (!existingConfig) {
                return res.status(404).json({
                    success: false,
                    error: 'Configuration not found'
                });
            }

            // Security check: can only update an accessible location's config or global
            if (existingConfig.location_code !== '*' && !security.canAccessLocation(req.user, existingConfig.location_code)) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only update configurations for your assigned location(s) or global settings'
                });
            }

            const cleanSettingValue = setting_value.trim();

            // Update config (this will end-date old and create new)
            const updatedConfig = await LocationConfigDao.updateConfig(
                configId, 
                cleanSettingValue, 
                username
            );

            res.json({
                success: true,
                message: 'Configuration updated successfully',
                data: updatedConfig
            });

        } catch (error) {
            console.error('Error updating config:', error);
            
            // Check for specific error types
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            
            if (error.message && error.message.includes('expired')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            
            res.status(500).json({
                success: false,
                error: 'Failed to update configuration: ' + error.message
            });
        }
    },

    /**
     * GET /location-config/api/configs
     * Get configs with optional filter (for AJAX refresh)
     */
    getConfigsAPI: async (req, res, next) => {
        try {
            const requestedFilter = req.query.location || 'ALL';
            const configType = req.query.type || 'active'; // active or history
            const accessibleLocations = security.getAccessibleLocations(req.user); // null = unrestricted, else array

            // Resolve the requested filter against what this user is actually allowed to see —
            // a restricted user can't bypass their scope by passing ?location=ALL or another location's code.
            let effectiveFilter;
            if (requestedFilter === '*') {
                effectiveFilter = '*'; // global-only is always visible, regardless of role
            } else if (accessibleLocations === null) {
                effectiveFilter = requestedFilter === 'ALL' ? null : requestedFilter;
            } else if (requestedFilter === 'ALL' || !accessibleLocations.includes(requestedFilter)) {
                effectiveFilter = accessibleLocations;
            } else {
                effectiveFilter = requestedFilter;
            }

            let configs;
            if (configType === 'history') {
                configs = await LocationConfigDao.getHistoryConfigs(effectiveFilter);
            } else {
                configs = await LocationConfigDao.getAllConfigs(effectiveFilter);
            }

            // Format dates
            const formattedConfigs = configs.map(config => ({
                ...config,
                effective_start_date_formatted: dateFormat(config.effective_start_date, 'dd-mmm-yyyy'),
                effective_end_date_formatted: dateFormat(config.effective_end_date, 'dd-mmm-yyyy'),
                creation_date_formatted: config.creation_date ? 
                    dateFormat(config.creation_date, 'dd-mmm-yyyy HH:MM') : 'N/A',
                is_global: config.location_code === '*'
            }));

            res.json({
                success: true,
                data: formattedConfigs
            });

        } catch (error) {
            console.error('Error fetching configs via API:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch configurations: ' + error.message
            });
        }
    },

    /**
     * GET /location-config/api/config/:configId
     * Get single config by ID (for edit modal)
     */
    getConfigByIdAPI: async (req, res, next) => {
        try {
            const configId = req.params.configId;
            const config = await LocationConfigDao.getConfigById(configId);

            if (!config) {
                return res.status(404).json({
                    success: false,
                    error: 'Configuration not found'
                });
            }

            // Format dates
            const formattedConfig = {
                ...config,
                effective_start_date_formatted: dateFormat(config.effective_start_date, 'dd-mmm-yyyy'),
                effective_end_date_formatted: dateFormat(config.effective_end_date, 'dd-mmm-yyyy'),
                is_global: config.location_code === '*'
            };

            res.json({
                success: true,
                data: formattedConfig
            });

        } catch (error) {
            console.error('Error fetching config by ID:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch configuration: ' + error.message
            });
        }
    },

    /**
     * PUT /location-config/catalog/:settingName
     * Create/update the description for a setting_name (independent of any location's value).
     * Any authenticated user with MANAGE_LOCATION_CONFIG can edit descriptions.
     */
    updateCatalogDescription: async (req, res, next) => {
        try {
            const settingName = req.params.settingName.trim().toUpperCase();
            const { short_description, detailed_description } = req.body;
            const username = req.user.username;

            if (!settingName) {
                return res.status(400).json({
                    success: false,
                    error: 'Setting name is required'
                });
            }

            const updated = await LocationConfigDao.upsertCatalogEntry(
                settingName,
                (short_description || '').trim(),
                (detailed_description || '').trim(),
                username
            );

            res.json({
                success: true,
                message: 'Description saved successfully',
                data: updated
            });
        } catch (error) {
            console.error('Error updating catalog description:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save description: ' + error.message
            });
        }
    },

    /**
     * POST /location-config/validate-duplicate
     * Check if setting name already exists for location
     */
    validateDuplicate: async (req, res, next) => {
        try {
            const { location_code, setting_name, exclude_config_id } = req.body;

            if (!location_code || !setting_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Location code and setting name are required'
                });
            }

            const isDuplicate = await LocationConfigDao.checkDuplicateSetting(
                location_code.trim(),
                setting_name.trim().toUpperCase(),
                exclude_config_id || null
            );

            res.json({
                success: true,
                isDuplicate: isDuplicate,
                message: isDuplicate ? 
                    'Setting already exists for this location' : 
                    'Setting name is available'
            });

        } catch (error) {
            console.error('Error validating duplicate:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to validate setting name: ' + error.message
            });
        }
    }
};