const dateFormat = require('dateformat');
const moment = require('moment');
const CashflowDetailedDao = require("../dao/cashflow-detailed-dao");

const CashflowDetailedReportsController = {
    
    getCashflowDetailedReport: async (req, res, next) => {
        try {
            console.log('getCashflowDetailedReport: Starting execution');
            
            let fromDate = req.body.fromClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.body.toClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.user.location_code;
            let caller = req.body.caller || 'notpdf';
            
            console.log(`getCashflowDetailedReport: Parameters - fromDate: ${fromDate}, toDate: ${toDate}, location: ${locationCode}`);
            
            // Fetch the cashflow detailed data
            const cashflowDetailedData = await CashflowDetailedDao.getCashflowDetailedData(fromDate, toDate, locationCode);
            console.log(`getCashflowDetailedReport: Retrieved ${cashflowDetailedData.length} records`);
            
            // Format dates for display
            const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
            const formattedToDate = moment(toDate).format('DD/MM/YYYY');
            
            // Prepare render data
            const renderData = {
                title: 'Cashflow Detailed Report',
                user: req.user,
                fromClosingDate: fromDate,
                toClosingDate: toDate,
                formattedFromDate: formattedFromDate,
                formattedToDate: formattedToDate,
                cashflowDetailedData: cashflowDetailedData,
                currentDate: dateFormat(new Date(), "yyyy-mm-dd"),
                caller: caller
            };
            
            if (caller === 'notpdf') {
                res.render('reports-cashflow-detailed', renderData);
            } else {
                // For PDF generation - return Promise with rendered HTML
                return new Promise((resolve, reject) => {
                    res.render('reports-cashflow-detailed', renderData, (err, html) => {
                        if (err) {
                            console.error('getCashflowDetailedReport: Error in res.render:', err);
                            reject(err);
                        } else {
                            console.log('getCashflowDetailedReport: Successfully rendered HTML');
                            resolve(html);
                        }
                    });
                });
            }
            
        } catch (error) {
            console.error('getCashflowDetailedReport: Error occurred:', error);
            res.status(500).send('Error generating cashflow detailed report: ' + error.message);
        }
    },
    
    getApiCashflowDetailedReport: async (req, res) => {
        try {
            console.log('getApiCashflowDetailedReport: API call received');
            
            let fromDate = req.body.fromDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.body.toDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.body.location_code || req.user.location_code;
            
            // Fetch cashflow data
            const cashflowDetailedData = await CashflowDetailedDao.getCashflowDetailedData(fromDate, toDate, locationCode);
            
            res.json({
                success: true,
                data: cashflowDetailedData,
                message: `Retrieved ${cashflowDetailedData.length} records`,
                fromDate: fromDate,
                toDate: toDate
            });
            
        } catch (error) {
            console.error('getApiCashflowDetailedReport: Error occurred:', error);
            res.status(500).json({
                success: false,
                message: 'Error generating Cashflow Detailed Report',
                error: error.message
            });
        }
    },
    
    getCashflowDetailedSummary: async (req, res) => {
        try {
            console.log('getCashflowDetailedSummary: API call received');
            
            let fromDate = req.query.fromDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.query.toDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.user.location_code;
            
            const summaryData = await CashflowDetailedDao.getCashflowDetailedSummary(fromDate, toDate, locationCode);
            
            res.json({
                success: true,
                data: summaryData,
                message: 'Summary retrieved successfully'
            });
            
        } catch (error) {
            console.error('getCashflowDetailedSummary: Error occurred:', error);
            res.status(500).json({
                success: false,
                message: 'Error retrieving summary data',
                error: error.message
            });
        }
    }
};

module.exports = CashflowDetailedReportsController;