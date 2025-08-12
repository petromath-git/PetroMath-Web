// controllers/reports-tally-daybook-controller.js
const TallyDaybookDao = require("../dao/tally-daybook-dao");
const dateFormat = require('dateformat');
const moment = require('moment');

const TallyDaybookReportsController = {
    
    getTallyDaybookReport: async (req, res, next) => {
        try {
            console.log('getTallyDaybookReport: Starting execution');
            
            let fromDate = req.body.fromClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.body.toClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.user.location_code;
            let caller = req.body.caller || 'notpdf';
            
            console.log(`getTallyDaybookReport: Parameters - fromDate: ${fromDate}, toDate: ${toDate}, location: ${locationCode}`);
            
            // Generate the tally daybook report data by calling the stored procedure
           // const reportGenResult = await TallyDaybookDao.generateTallyDaybookReport(fromDate, toDate, locationCode);
            console.log('getTallyDaybookReport: Report generation completed');
            
            // Fetch the generated report data
            const tallyDaybookData = await TallyDaybookDao.getTallyDaybookReportData(fromDate, toDate, locationCode);
            console.log(`getTallyDaybookReport: Retrieved ${tallyDaybookData.length} records`);
            
            // Format dates for display
            const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
            const formattedToDate = moment(toDate).format('DD/MM/YYYY');
            
            // Prepare render data
            const renderData = {
                title: 'Tally Daybook Report',
                user: req.user,
                fromClosingDate: fromDate,
                toClosingDate: toDate,
                formattedFromDate: formattedFromDate,
                formattedToDate: formattedToDate,
                tallyDaybookData: tallyDaybookData,
                currentDate: dateFormat(new Date(), "yyyy-mm-dd")
            };
            
            if (caller === 'notpdf') {
                res.render('reports-tally-daybook', renderData);
            } else {
                // For PDF generation using your existing generic getPDF method
                return new Promise((resolve, reject) => {
                    res.render('reports-tally-daybook', renderData, (err, html) => {
                        if (err) {
                            console.error('getTallyDaybookReport: Error in res.render:', err);
                            reject(err);
                        } else {
                            console.log('getTallyDaybookReport: Successfully rendered HTML');
                            resolve(html);
                        }
                    });
                });
            }
            
        } catch (error) {
            console.error('getTallyDaybookReport: Error occurred:', error);
            res.status(500).render('error', { 
                title: 'Error',
                message: 'Error generating Tally Daybook Report',
                error: error 
            });
        }
    },
    
    getApiTallyDaybookReport: async (req, res) => {
        try {
            console.log('getApiTallyDaybookReport: API call received');
            
            let fromDate = req.body.fromDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.body.toDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.body.location_code || req.user.location_code;
            
            // Generate and fetch report data
        //    await TallyDaybookDao.generateTallyDaybookReport(fromDate, toDate, locationCode);
            const tallyDaybookData = await TallyDaybookDao.getTallyDaybookReportData(fromDate, toDate, locationCode);
            
            res.json({
                success: true,
                data: tallyDaybookData,
                message: `Retrieved ${tallyDaybookData.length} records`,
                fromDate: fromDate,
                toDate: toDate
            });
            
        } catch (error) {
            console.error('getApiTallyDaybookReport: Error occurred:', error);
            res.status(500).json({
                success: false,
                message: 'Error generating Tally Daybook Report',
                error: error.message
            });
        }
    },
    
    getTallyDaybookSummary: async (req, res) => {
        try {
            console.log('getTallyDaybookSummary: API call received');
            
            let fromDate = req.query.fromDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.query.toDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.user.location_code;
            
            const summaryData = await TallyDaybookDao.getTallyDaybookSummary(fromDate, toDate, locationCode);
            
            res.json({
                success: true,
                data: summaryData,
                message: `Retrieved summary for ${summaryData.length} voucher types`
            });
            
        } catch (error) {
            console.error('getTallyDaybookSummary: Error occurred:', error);
            res.status(500).json({
                success: false,
                message: 'Error retrieving summary data',
                error: error.message
            });
        }
    },
    
    cleanupTallyTempData: async (req, res) => {
        try {
            console.log('cleanupTallyTempData: Cleanup request received');
            
            const daysOld = req.body.daysOld || 30;
            const deletedCount = await TallyDaybookDao.cleanupTallyTempData(daysOld);
            
            res.json({
                success: true,
                message: `Successfully cleaned up ${deletedCount} old records`,
                deletedCount: deletedCount
            });
            
        } catch (error) {
            console.error('cleanupTallyTempData: Error occurred:', error);
            res.status(500).json({
                success: false,
                message: 'Error during cleanup',
                error: error.message
            });
        }
    }
};

module.exports = TallyDaybookReportsController;