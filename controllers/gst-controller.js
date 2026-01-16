const GstConfigDao = require("../dao/gst-config-dao");
const GstReturnDataDao = require("../dao/gst-return-data-dao");
const GstDataAggregationDao = require("../dao/gst-data-aggregation-dao");
const GSTR1Generator = require("../services/gstr1-generator");
const GSTR3BGenerator = require("../services/gstr3b-generator");
const gstUtils = require("../utils/gst-utils");
const dateFormat = require('dateformat');

module.exports = {
    /**
     * GST Dashboard - Main page
     */
    getDashboard: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            
            // Get GST config
            const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
            
            // Get recent returns
            const recentReturns = await GstReturnDataDao.findByLocation(locationCode, null, 10);
            
            // Get current period
            const currentPeriod = gstUtils.getCurrentReturnPeriod();
            
            res.render('gst/dashboard', {
                title: 'GST Returns',
                user: req.user,
                gstConfig: gstConfig,
                recentReturns: recentReturns,
                currentPeriod: currentPeriod,
                formattedPeriod: gstUtils.formatReturnPeriod(currentPeriod)
            });
            
        } catch (error) {
            console.error('Error loading GST dashboard:', error);
            req.flash('error', 'Failed to load GST dashboard: ' + error.message);
            res.redirect('/home');
        }
    },

    /**
     * Generate Return Page
     */
    getGenerateReturnPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const returnType = req.params.returnType; // GSTR1 or GSTR3B
            
            // Get GST config
            const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
            
            if (!gstConfig) {
                req.flash('error', 'GST configuration not found. Please setup GST configuration first.');
                return res.redirect('/gst/config');
            }
            
            // Get current period
            const currentPeriod = gstUtils.getCurrentReturnPeriod();
            
            res.render('gst/generate-return', {
                title: `Generate ${returnType}`,
                user: req.user,
                gstConfig: gstConfig,
                returnType: returnType,
                currentPeriod: currentPeriod,
                formattedPeriod: gstUtils.formatReturnPeriod(currentPeriod)
            });
            
        } catch (error) {
            console.error('Error loading generate return page:', error);
            req.flash('error', 'Failed to load page: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * Preview Return Data (AJAX)
     */
   /**
 * Preview Return Data (Form POST)
 */
previewReturn: async (req, res) => {
    try {
        const locationCode = req.user.location_code;
        const returnPeriod = req.body.return_period;
        const returnType = req.body.return_type;
        
        // Get GST config
        const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
        
        if (!gstConfig) {
            req.flash('error', 'GST configuration not found');
            return res.redirect('/gst/config');
        }
        
        let result;
        
        if (returnType === 'GSTR1') {
            // Validate first
            const validation = await GSTR1Generator.validateGSTR1Data(locationCode, returnPeriod);
            
            // Generate
            result = await GSTR1Generator.generateGSTR1Json(
                locationCode,
                gstConfig.gstin,
                returnPeriod
            );
            
            result.validation = validation;
        } else if (returnType === 'GSTR3B') {
            // Validate first
            const validation = await GSTR3BGenerator.validateGSTR3BData(locationCode, returnPeriod);
            
            // Generate
            result = await GSTR3BGenerator.generateGSTR3BJson(
                locationCode,
                gstConfig.gstin,
                returnPeriod
            );
            
            result.validation = validation;
        }
        
        // Render preview page
        res.render('gst/preview-return', {
            title: `Preview ${returnType}`,
            user: req.user,
            returnType: returnType,
            returnPeriod: returnPeriod,
            gstConfig: gstConfig,
            validation: result.validation,
            summary: result.summary,
            returnJson: result.data
        });
        
    } catch (error) {
        console.error('Error previewing return:', error);
        req.flash('error', 'Failed to preview return: ' + error.message);
        res.redirect('/gst');
    }
},

    /**
     * Download Return JSON
     */
    downloadReturn: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const returnPeriod = req.body.return_period;
            const returnType = req.body.return_type;
            
            // Get GST config
            const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
            
            if (!gstConfig) {
                req.flash('error', 'GST configuration not found');
                return res.redirect('/gst');
            }
            
            let result;
            const periodDates = gstUtils.getPeriodDates(returnPeriod);
            
            if (returnType === 'GSTR1') {
                result = await GSTR1Generator.generateGSTR1Json(
                    locationCode,
                    gstConfig.gstin,
                    returnPeriod
                );
                
                // Save to database
                await GstReturnDataDao.create({
                    location_code: locationCode,
                    gstin: gstConfig.gstin,
                    return_type: 'GSTR1',
                    return_period: returnPeriod,
                    financial_year: periodDates.financial_year,
                    from_date: periodDates.from_date,
                    to_date: periodDates.to_date,
                    return_json: JSON.stringify(result.data),
                    status: 'READY',
                    total_taxable_value: 0,
                    created_by: req.user.Person_id || req.user.username
                });
                
            } else if (returnType === 'GSTR3B') {
                result = await GSTR3BGenerator.generateGSTR3BJson(
                    locationCode,
                    gstConfig.gstin,
                    returnPeriod
                );
                
                // Save to database
                await GstReturnDataDao.create({
                    location_code: locationCode,
                    gstin: gstConfig.gstin,
                    return_type: 'GSTR3B',
                    return_period: returnPeriod,
                    financial_year: periodDates.financial_year,
                    from_date: periodDates.from_date,
                    to_date: periodDates.to_date,
                    return_json: JSON.stringify(result.data),
                    status: 'READY',
                    total_taxable_value: parseFloat(result.summary?.total_taxable_value || 0),
                    total_cgst: parseFloat(result.summary?.total_tax || 0) / 2,
                    total_sgst: parseFloat(result.summary?.total_tax || 0) / 2,
                    created_by: req.user.Person_id || req.user.username
                });
            }
            
            // Set download headers
            const filename = `${returnType}_${gstConfig.gstin}_${returnPeriod}.json`;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            // Send file
            res.send(JSON.stringify(result.data, null, 2));
            
        } catch (error) {
            console.error('Error downloading return:', error);
            req.flash('error', 'Failed to download return: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * Filing History
     */
    getFilingHistory: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            
            // Get all returns
            const returns = await GstReturnDataDao.findByLocation(locationCode, null, 50);
            
            // Format dates
            const formattedReturns = returns.map(ret => ({
                ...ret,
                formatted_period: gstUtils.formatReturnPeriod(ret.return_period),
                formatted_date: dateFormat(ret.creation_date, 'dd-mmm-yyyy HH:MM')
            }));
            
            res.render('gst/filing-history', {
                title: 'GST Filing History',
                user: req.user,
                returns: formattedReturns
            });
            
        } catch (error) {
            console.error('Error loading filing history:', error);
            req.flash('error', 'Failed to load filing history: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * View Return Details
     */
    getReturnDetails: async (req, res) => {
        try {
            const returnDataId = req.params.returnDataId;
            
            // Get return
            const returnData = await GstReturnDataDao.findById(returnDataId);
            
            if (!returnData) {
                req.flash('error', 'Return not found');
                return res.redirect('/gst/history');
            }
            
            // Parse JSON
            const returnJson = JSON.parse(returnData.return_json);
            
            res.render('gst/return-details', {
                title: `${returnData.return_type} Details`,
                user: req.user,
                returnData: returnData,
                returnJson: returnJson,
                formatted_period: gstUtils.formatReturnPeriod(returnData.return_period)
            });
            
        } catch (error) {
            console.error('Error loading return details:', error);
            req.flash('error', 'Failed to load return details: ' + error.message);
            res.redirect('/gst/history');
        }
    },

    /**
     * GST Configuration Page
     */
    getConfigPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            
            // Get config
            const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
            
            res.render('gst/config', {
                title: 'GST Configuration',
                user: req.user,
                gstConfig: gstConfig
            });
            
        } catch (error) {
            console.error('Error loading GST config page:', error);
            req.flash('error', 'Failed to load configuration page: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * Save GST Configuration
     */
    saveConfig: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const { gstin } = req.body;
            
            // Validate GSTIN
            if (!gstUtils.isValidGstin(gstin)) {
                req.flash('error', 'Invalid GSTIN format');
                return res.redirect('/gst/config');
            }
            
            // Check if config exists
            const existingConfig = await GstConfigDao.findByLocationCode(locationCode);
            
            if (existingConfig) {
                // Update
                await GstConfigDao.updateByLocationCode(locationCode, {
                    gstin: gstin,
                    updated_by: req.user.Person_id || req.user.username,
                    updation_date: new Date()
                });
            } else {
                // Create
                await GstConfigDao.create({
                    location_code: locationCode,
                    gstin: gstin,
                    api_provider: 'MANUAL',
                    environment: 'PRODUCTION',
                    is_active: 1,
                    created_by: req.user.Person_id || req.user.username
                });
            }
            
            req.flash('success', 'GST configuration saved successfully');
            res.redirect('/gst');
            
        } catch (error) {
            console.error('Error saving GST config:', error);
            req.flash('error', 'Failed to save configuration: ' + error.message);
            res.redirect('/gst/config');
        }
    }
};