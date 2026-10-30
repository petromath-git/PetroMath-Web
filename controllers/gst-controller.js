const GstConfigDao = require("../dao/gst-config-dao");
const GstReturnDataDao = require("../dao/gst-return-data-dao");
const GstDataAggregationDao = require("../dao/gst-data-aggregation-dao");
const GSTR1Generator = require("../services/gstr1-generator");
const GSTR3BGenerator = require("../services/gstr3b-generator");
const Gstr1ReturnService = require("../services/gstr1-return-service");
const gstUtils = require("../utils/gst-utils");
const dateFormat = require('dateformat');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

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
                mobileReady: true,
                user: req.user,
                gstConfig: gstConfig,
                recentReturns: recentReturns,
                currentPeriod: currentPeriod,
                formattedPeriod: gstUtils.formatReturnPeriod(currentPeriod),
                periods: gstUtils.getRecentPeriods(12),
                dateFmt: (d) => moment(d).utcOffset(330).format('DD-MMM-YYYY HH:mm')
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
            if (returnType === 'GSTR1') return res.redirect('/gst/gstr1');
            
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
/**
 * Preview Return Data (Form POST)
 * UPDATED: Added detailed breakdown for GSTR-3B
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
        
        // Get period dates
        const periodDates = gstUtils.getPeriodDates(returnPeriod);
        const { from_date, to_date } = periodDates;
        
        let result;
        let salesBreakdown = null;
        let purchaseBreakdown = null;
        
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
            
            // Fetch detailed breakdown for preview
            salesBreakdown = await GstDataAggregationDao.getGSTR3BSalesBreakdown(locationCode, from_date, to_date);
            purchaseBreakdown = await GstDataAggregationDao.getGSTR3BPurchaseBreakdown(locationCode, from_date, to_date);
        }
        
        // Render preview
        res.render('gst/preview-return', {
            title: `${returnType} Preview`,
            user: req.user,
            returnType: returnType,
            returnPeriod: returnPeriod,
            formattedPeriod: gstUtils.formatReturnPeriod(returnPeriod),
            returnJson: result.data,
            summary: result.summary,
            validation: result.validation,
            salesBreakdown: salesBreakdown,      // NEW: Pass sales breakdown
            purchaseBreakdown: purchaseBreakdown  // NEW: Pass purchase breakdown
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
            
            if (!returnData || returnData.location_code !== req.user.location_code) {
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
     * GSTR-1 built from the GST Summary: checks, HSN tables, tie-out, 3B figures
     */
    getGstr1: async (req, res) => {
        const period = gstUtils.isValidReturnPeriod(req.query.period) ? req.query.period : gstUtils.getCurrentReturnPeriod();
        const includeFuelInHsn = req.query.fuelHsn !== '0';
        try {
            const gstConfig = await GstConfigDao.findByLocationCode(req.user.location_code);
            if (!gstConfig) {
                req.flash('error', 'Enter the GSTIN for this location first.');
                return res.redirect('/gst/config');
            }
            const result = await Gstr1ReturnService.buildGstr1(req.user.location_code, period, { includeFuelInHsn });
            res.render('gst/gstr1', {
                title: 'GSTR-1',
                mobileReady: true,
                user: req.user,
                r: result,
                periods: gstUtils.getRecentPeriods(12),
                downloadUrl: `/gst/gstr1/download?period=${period}&fuelHsn=${includeFuelInHsn ? 1 : 0}`
            });
        } catch (error) {
            console.error('Error building GSTR-1:', error);
            req.flash('error', 'Could not build GSTR-1: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * GSTR-1 JSON download; refused while the page shows errors
     */
    downloadGstr1: async (req, res) => {
        const period = req.query.period;
        if (!gstUtils.isValidReturnPeriod(period)) return res.status(400).send('Invalid period');
        const includeFuelInHsn = req.query.fuelHsn !== '0';
        try {
            const locationCode = req.user.location_code;
            const result = await Gstr1ReturnService.buildGstr1(locationCode, period, { includeFuelInHsn });
            if (!result.canDownload) {
                req.flash('error', 'Fix the errors listed on the page before downloading.');
                return res.redirect(`/gst/gstr1?period=${period}&fuelHsn=${includeFuelInHsn ? 1 : 0}`);
            }
            const periodDates = gstUtils.getPeriodDates(period);
            const totals = result.gstr3b.outward;
            await GstReturnDataDao.create({
                location_code: locationCode,
                gstin: result.gstin,
                return_type: 'GSTR1',
                return_period: period,
                financial_year: periodDates.financial_year,
                from_date: periodDates.from_date,
                to_date: periodDates.to_date,
                return_json: JSON.stringify(result.json),
                status: 'READY',
                total_taxable_value: totals.txval.toFixed(2),
                total_cgst: totals.camt.toFixed(2),
                total_sgst: totals.samt.toFixed(2),
                notes: includeFuelInHsn ? 'Fuel included in HSN summary' : 'Fuel left out of HSN summary',
                created_by: req.user.Person_id || req.user.username
            });
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${result.gstin}_${period}.json"`);
            res.send(JSON.stringify(result.json));
        } catch (error) {
            console.error('Error downloading GSTR-1:', error);
            req.flash('error', 'Could not build GSTR-1: ' + error.message);
            res.redirect('/gst');
        }
    },

    /**
     * Step-by-step guide to upload and file on the GST portal
     */
    getGuide: async (req, res) => {
        const gstConfig = await GstConfigDao.findByLocationCode(req.user.location_code);
        // Screenshots are optional: public/images/gst-guide/<step>.png shows under that step once added.
        const shotDir = path.join(__dirname, '..', 'public', 'images', 'gst-guide');
        const shots = {};
        try {
            fs.readdirSync(shotDir).forEach(f => {
                const m = f.match(/^([a-z0-9-]+)\.(png|jpg|jpeg|webp)$/i);
                if (m) shots[m[1]] = `/images/gst-guide/${f}`;
            });
        } catch (e) { /* no screenshots yet */ }
        res.render('gst/guide', {
            title: 'How to file GSTR-1 and GSTR-3B',
            mobileReady: true,
            user: req.user,
            gstConfig: gstConfig,
            shots: shots,
            lastMonth: gstUtils.getCurrentReturnPeriod()
        });
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
            if (!Gstr1ReturnService.isValidGstin(gstin)) {
                req.flash('error', 'Invalid GSTIN (format or check digit). Copy it from your GST certificate.');
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