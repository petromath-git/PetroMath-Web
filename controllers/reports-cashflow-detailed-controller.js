const dateFormat = require('dateformat');
const moment = require('moment');
const ExcelJS = require('exceljs');
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
    
    exportCashflowDetailedExcel: async (req, res) => {
        try {
            let fromDate = req.body.fromClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.body.toClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
            let locationCode = req.user.location_code;

            const cashflowDetailedData = await CashflowDetailedDao.getCashflowDetailedData(fromDate, toDate, locationCode);

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Cashflow Detailed');

            sheet.getCell('A1').value = req.user.station_name || locationCode;
            sheet.getCell('A1').font = { bold: true, size: 13 };
            sheet.getCell('A2').value = 'Cashflow Detailed Report';
            sheet.getCell('A2').font = { bold: true };
            sheet.getCell('A3').value =
                `${moment(fromDate).format('DD-MMM-YYYY')} to ${moment(toDate).format('DD-MMM-YYYY')}`;

            const headers = ['Date', 'Type', 'Category', 'Description', 'Debit', 'Credit'];
            const headerRow = sheet.getRow(5);
            headers.forEach((h, i) => {
                const cell = headerRow.getCell(i + 1);
                cell.value = h;
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
                cell.border = {
                    top: { style: 'thin' }, bottom: { style: 'thin' },
                    left: { style: 'thin' }, right: { style: 'thin' }
                };
                cell.alignment = { horizontal: 'center' };
            });

            let totalDebit = 0;
            let totalCredit = 0;

            cashflowDetailedData.forEach((row, idx) => {
                const r = sheet.getRow(6 + idx);
                r.getCell(1).value = row.transaction_date;
                r.getCell(2).value = row.type;
                r.getCell(3).value = row.category;
                r.getCell(4).value = row.description;

                const amount = parseFloat(row.amount);
                const isDebit = row.flow_type === 'DEBIT';
                r.getCell(5).value = isDebit ? amount : null;
                r.getCell(6).value = !isDebit ? amount : null;

                if (isDebit) {
                    totalDebit += amount;
                } else {
                    totalCredit += amount;
                }

                [5, 6].forEach(c => {
                    if (r.getCell(c).value !== null) {
                        r.getCell(c).numFmt = '#,##0.00';
                        r.getCell(c).alignment = { horizontal: 'right' };
                    }
                });

                r.eachCell(cell => {
                    cell.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' },
                        left: { style: 'thin' }, right: { style: 'thin' }
                    };
                });
            });

            const summaryRow = sheet.getRow(7 + cashflowDetailedData.length);
            summaryRow.getCell(4).value = 'Net Cashflow';
            summaryRow.getCell(4).font = { bold: true };
            summaryRow.getCell(5).value = totalDebit;
            summaryRow.getCell(6).value = totalCredit;
            [5, 6].forEach(c => {
                summaryRow.getCell(c).numFmt = '#,##0.00';
                summaryRow.getCell(c).font = { bold: true };
                summaryRow.getCell(c).alignment = { horizontal: 'right' };
            });

            sheet.getColumn(1).width = 14;
            sheet.getColumn(2).width = 12;
            sheet.getColumn(3).width = 22;
            sheet.getColumn(4).width = 40;
            sheet.getColumn(5).width = 16;
            sheet.getColumn(6).width = 16;

            const buffer = await workbook.xlsx.writeBuffer();
            const filename = `CashflowDetailed_${locationCode}_${moment(fromDate).format('DDMMYYYY')}_${moment(toDate).format('DDMMYYYY')}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);

        } catch (error) {
            console.error('exportCashflowDetailedExcel: Error occurred:', error);
            res.status(500).send('An error occurred while generating the Cashflow Detailed Excel file.');
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