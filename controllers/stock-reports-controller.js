// controllers/stock-reports-controller.js
const stockReportsDao = require('../dao/stock-reports-dao');
const stockAdjustmentDao = require('../dao/stock-adjustment-dao');
const moment = require('moment');

module.exports = {

    // Stock Summary Report
    getStockSummaryReport: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const caller = req.body.caller || 'notpdf';
            
            // Get report date from body (POST) or query (GET)
            let reportDate = req.body.reportDate || req.query.reportDate;
            
            // Convert to YYYY-MM-DD format if it's a Date object
            if (reportDate instanceof Date) {
                reportDate = moment(reportDate).format('YYYY-MM-DD');
            } else if (reportDate) {
                reportDate = moment(reportDate).format('YYYY-MM-DD');
            }

            let stockSummary = [];

            // Generate report if date is provided
            if (reportDate) {
                stockSummary = await stockReportsDao.getStockSummary(locationCode, reportDate);
            }

            const formattedDate = reportDate ? moment(reportDate).format('DD/MM/YYYY') : '';
            const currentDate = moment().format('YYYY-MM-DD');

            if (caller === 'notpdf') {
                res.render('reports-stock-summary', {
                    title: 'Stock Summary Report',
                    user: req.user,
                    stockSummary: stockSummary,
                    reportDate: reportDate,
                    formattedDate: formattedDate,
                    currentDate: currentDate
                });
            } else {
                // For PDF generation
                return new Promise((resolve, reject) => {
                    res.render('reports-stock-summary', {
                        title: 'Stock Summary Report',
                        user: req.user,
                        stockSummary: stockSummary,
                        reportDate: reportDate,
                        formattedDate: formattedDate,
                        currentDate: currentDate
                    }, (err, html) => {
                        if (err) {
                            console.error('getStockSummaryReport: Error in res.render:', err);
                            reject(err);
                        } else {
                            console.log('getStockSummaryReport: Successfully rendered HTML');
                            resolve(html);
                        }
                    });
                });
            }

        } catch (error) {
            console.error('Error in getStockSummaryReport:', error);
            req.flash('error', 'Failed to generate stock summary report');
            res.redirect('/home');
        }
    },

    // Stock Ledger Report
    getStockLedgerReport: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const caller = req.body.caller || 'notpdf';
            
            // Get parameters from body (POST) or query (GET)
            const productId = req.body.productId || req.query.productId || null;
            let fromDate = req.body.fromDate || req.query.fromDate;
            let toDate = req.body.toDate || req.query.toDate;

            // Convert dates to YYYY-MM-DD format
            if (fromDate instanceof Date) {
                fromDate = moment(fromDate).format('YYYY-MM-DD');
            } else if (fromDate) {
                fromDate = moment(fromDate).format('YYYY-MM-DD');
            }

            if (toDate instanceof Date) {
                toDate = moment(toDate).format('YYYY-MM-DD');
            } else if (toDate) {
                toDate = moment(toDate).format('YYYY-MM-DD');
            }

            // Get all products for dropdown
            const products = await stockAdjustmentDao.getProductsNotLinkedToPumps(locationCode);

            let ledgerData = [];
            let productInfo = null;
            let openingBalance = 0;
            let closingBalance = 0;
            let totalIn = 0;
            let totalOut = 0;

            // If product is selected, get ledger data
            if (productId && fromDate && toDate) {
                productInfo = products.find(p => p.product_id == productId);
                
                // Get opening balance (stock on day before fromDate)
                const dayBeforeFrom = moment(fromDate).subtract(1, 'day').format('YYYY-MM-DD');
                openingBalance = await stockReportsDao.getStockBalance(
                    productId, 
                    locationCode, 
                    dayBeforeFrom
                );

                // Get ledger transactions
                ledgerData = await stockReportsDao.getStockLedger(
                    productId, 
                    locationCode, 
                    fromDate, 
                    toDate
                );

                // Calculate totals
                totalIn = ledgerData.reduce((sum, txn) => sum + parseFloat(txn.in_qty || 0), 0);
                totalOut = ledgerData.reduce((sum, txn) => sum + parseFloat(txn.out_qty || 0), 0);
                closingBalance = parseFloat(openingBalance) + totalIn - totalOut;
            }

            const formattedFromDate = fromDate ? moment(fromDate).format('DD/MM/YYYY') : '';
            const formattedToDate = toDate ? moment(toDate).format('DD/MM/YYYY') : '';
            const currentDate = moment().format('YYYY-MM-DD');

            if (caller === 'notpdf') {
                res.render('reports-stock-ledger', {
                    title: 'Stock Ledger Report',
                    user: req.user,
                    products: products,
                    ledgerData: ledgerData,
                    productInfo: productInfo,
                    openingBalance: parseFloat(openingBalance).toFixed(2),
                    closingBalance: closingBalance.toFixed(2),
                    totalIn: totalIn.toFixed(2),
                    totalOut: totalOut.toFixed(2),
                    fromDate: fromDate,
                    toDate: toDate,
                    formattedFromDate: formattedFromDate,
                    formattedToDate: formattedToDate,
                    selectedProductId: productId,
                    currentDate: currentDate
                });
            } else {
                // For PDF generation
                return new Promise((resolve, reject) => {
                    res.render('reports-stock-ledger', {
                        title: 'Stock Ledger Report',
                        user: req.user,
                        products: products,
                        ledgerData: ledgerData,
                        productInfo: productInfo,
                        openingBalance: parseFloat(openingBalance).toFixed(2),
                        closingBalance: closingBalance.toFixed(2),
                        totalIn: totalIn.toFixed(2),
                        totalOut: totalOut.toFixed(2),
                        fromDate: fromDate,
                        toDate: toDate,
                        formattedFromDate: formattedFromDate,
                        formattedToDate: formattedToDate,
                        selectedProductId: productId,
                        currentDate: currentDate
                    }, (err, html) => {
                        if (err) {
                            console.error('getStockLedgerReport: Error in res.render:', err);
                            reject(err);
                        } else {
                            console.log('getStockLedgerReport: Successfully rendered HTML');
                            resolve(html);
                        }
                    });
                });
            }

        } catch (error) {
            console.error('Error in getStockLedgerReport:', error);
            req.flash('error', 'Failed to generate stock ledger report');
            res.redirect('/home');
        }
    }
};