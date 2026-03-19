const dateFormat = require('dateformat');
var GstSummaryDao = require("../dao/report-gst-summary-dao");
const moment = require('moment');
var locationdao = require("../dao/report-dao");
var personDao = require("../dao/person-dao");



module.exports = {
  getgstsummaryReport: async (req, res) => {
    try {
        let locationCode = req.body.locationCode||req.user.location_code;      // get from selected location.
        const locationDetails = await locationdao.getLocationDetails(locationCode);
        

        // Get today's date
        const today = new Date();
        // Create a new Date object for the first day of the current month
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        // Format the date as "yyyy-mm-dd"
        let fromDate = dateFormat(firstDayOfMonth, "yyyy-mm-dd");

        
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        let caller = req.body.caller;  // to know if this is for generating PDF or Serve to browser

        if(req.body.fromClosingDate) {
          fromDate =req.body.fromClosingDate;
        }
        if(req.body.toClosingDate) {
          toDate = req.body.toClosingDate;
        }


       

       const personId = req.user.Person_id; 
       const personLocationPromise =  await personDao.findUserLocations(personId);
       let personLocations = [];
      
            // Process Person Location Data
           personLocationPromise.forEach((locations) => {
             personLocations.push({
                 'LocationCodes': locations.location_code,           
             });
           });

           let renderData = {};    
  
      
      
       // Retrieve purchase data, fuel sales data, and non-fuel sales data concurrently.
      const purchaseDataPromise = GstSummaryDao.getpurchasesummary(locationCode, fromDate, toDate);
      const salesDataPromise = GstSummaryDao.getSalesConsolidated(locationCode, fromDate, toDate);
      const nonFuelSalesDataPromise = GstSummaryDao.getNonFuelSalesConsolidated(locationCode, fromDate, toDate);
      const nonFuelSalesByItemPromise = GstSummaryDao.getNonFuelSalesByItem(locationCode, fromDate, toDate);
      const nonFuelPurchaseInvoicesPromise = GstSummaryDao.getNonFuelPurchaseInvoicesByGST(locationCode, fromDate, toDate);

      const [purchaseData, salesData, nonFuelSalesData,
            nonFuelSalesByItem, nonFuelPurchaseInvoices] = await Promise.all([
        purchaseDataPromise,
        salesDataPromise,
        nonFuelSalesDataPromise,
        nonFuelSalesByItemPromise,
        nonFuelPurchaseInvoicesPromise
      ]);
        

        const groupedTransactions = purchaseData.reduce((acc, transaction) => {
          if (!acc[transaction.Product]) {
            acc[transaction.Product] = [];
          }
          acc[transaction.Product].push(transaction);
          return acc;
        }, {});

          // Process sales data: create a summary list with Product, Litres, and Amount
        const salesSummaryList = [];
        salesData.forEach((salesRow) => {
          salesSummaryList.push({
            'Product': salesRow.product,   // Ensure your DAO returns a column named "product"
            'Volume (Ltrs)': salesRow.litres,       // Total litres sold for the product
            'Amount': salesRow.amount        // Total sales amount for the product
          });
        });
        
         // Process non-fuel sales data: create a summary list with Product, Volume, and Amount.
      const nonFuelSalesSummaryList = [];
      nonFuelSalesData.forEach((salesRow) => {
        nonFuelSalesSummaryList.push({
          'Product': salesRow.product,            // The product name from m_product
          'Volume (Ltrs)': salesRow.total_qty,      // Total quantity sold (in litres)
          'Amount': salesRow.total_amount           // Total sales amount for the product
        });
      });
      

        // Group non-fuel sales item-wise by GST rate (one table per rate in the view)
        const groupedNonFuelSalesByGST = nonFuelSalesByItem.reduce((acc, row) => {
          const key = row.gst_rate;
          if (!acc[key]) acc[key] = [];
          acc[key].push({
            'Product': row.product_name,
            'Quantity': row.total_qty,
            'Amount': row.total_amount,
            'CGST': row.total_cgst,
            'SGST': row.total_sgst,
            'Total GST': parseFloat(row.total_cgst) + parseFloat(row.total_sgst)
          });
          return acc;
        }, {});

        // Group non-fuel purchase invoices by GST category
        const groupedNonFuelPurchaseInvoices = nonFuelPurchaseInvoices.reduce((acc, invoice) => {
          if (!acc[invoice.gst_category]) {
            acc[invoice.gst_category] = [];
          }
          acc[invoice.gst_category].push(invoice);
          return acc;
        }, {});

        const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
        const formattedToDate = moment(toDate).format('DD/MM/YYYY');

      // Prepare the render data
      renderData ={
        title: 'Reports', 
        user: req.user, 
        fromClosingDate: fromDate,
        toClosingDate: toDate, 
        personLocations: personLocations,
        locationName: locationDetails.location_name,
        locationCode: locationCode,
        formattedFromDate: formattedFromDate,
        formattedToDate: formattedToDate,            
        purchaseTransactionlist: groupedTransactions,
        salesSummaryList: salesSummaryList,
        nonFuelSalesSummaryList: nonFuelSalesSummaryList,
        groupedNonFuelSalesByGST: groupedNonFuelSalesByGST,
        groupedNonFuelPurchaseInvoices: groupedNonFuelPurchaseInvoices
      }
          
    
          // Render the appropriate response
      if (caller === 'notpdf') {
        res.render('reports-gst-summary', renderData);
      } else {
        return new Promise((resolve, reject) => {
          res.render('reports-gst-summary', renderData, (err, html) => {
            if (err) {
              console.error('getgstsummaryReport: Error in res.render:', err);
              reject(err);
            } else {
              console.log('getgstsummaryReport: Successfully rendered HTML');
              resolve(html);
            }
          });
        });
      }
    } catch (error) {
      console.error('Error fetching  data:', error);
      res.status(500).send('An error occurred while generating the GST Summary report.');
    }
  },

  exportGstSummaryExcel: async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        
        let locationCode = req.body.locationCode || req.user.location_code;
        const locationDetails = await locationdao.getLocationDetails(locationCode);

        let fromDate = req.body.fromClosingDate;
        let toDate = req.body.toClosingDate;

        // Fetch all data
        const purchaseDataPromise = GstSummaryDao.getpurchasesummary(locationCode, fromDate, toDate);
        const salesDataPromise = GstSummaryDao.getSalesConsolidated(locationCode, fromDate, toDate);
        const nonFuelSalesByItemPromise = GstSummaryDao.getNonFuelSalesByItem(locationCode, fromDate, toDate);
        const nonFuelPurchaseInvoicesPromise = GstSummaryDao.getNonFuelPurchaseInvoicesByGST(locationCode, fromDate, toDate);

        const [purchaseData, salesData, nonFuelSalesByItem, nonFuelPurchaseInvoices] = await Promise.all([
          purchaseDataPromise,
          salesDataPromise,
          nonFuelSalesByItemPromise,
          nonFuelPurchaseInvoicesPromise
        ]);

        // Helper function to convert to number
        const toNumber = (num) => parseFloat(num || 0);

        // Create workbook and worksheets
        const workbook = new ExcelJS.Workbook();
        
        // ============================================
        // SHEET 1: SALES
        // ============================================
        const salesSheet = workbook.addWorksheet('Sales');
        let currentRow = 1;
        
        // Title
        salesSheet.getCell(`A${currentRow}`).value = 'GST SUMMARY REPORT - SALES';
        salesSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
        currentRow++;
        
        salesSheet.getCell(`A${currentRow}`).value = locationDetails.location_name;
        currentRow++;
        
        salesSheet.getCell(`A${currentRow}`).value = `Period: ${moment(fromDate).format('DD/MM/YYYY')} to ${moment(toDate).format('DD/MM/YYYY')}`;
        currentRow += 2;
        
        // Fuel Sales
        salesSheet.getCell(`A${currentRow}`).value = 'FUEL SALES';
        salesSheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
        currentRow++;
        
        const fuelSalesHeaderRow = salesSheet.getRow(currentRow);
        fuelSalesHeaderRow.values = ['Product', 'Volume (Ltrs)', 'Amount'];
        fuelSalesHeaderRow.font = { bold: true };
        fuelSalesHeaderRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD3D3D3' }
            };
        });
        currentRow++;
        
        // Fuel Sales Data - STORE AS NUMBERS
        salesData.forEach(row => {
            const dataRow = salesSheet.getRow(currentRow);
            dataRow.getCell(1).value = row.product; // Text
            dataRow.getCell(2).value = toNumber(row.litres); // Number
            dataRow.getCell(3).value = toNumber(row.amount); // Number
            
            // Format number columns to 2 decimals
            dataRow.getCell(2).numFmt = '#,##0.00';
            dataRow.getCell(3).numFmt = '#,##0.00';
            
            dataRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
            currentRow++;
        });
        
        currentRow++;
        
        // Non-Fuel Sales - item-wise grouped by GST rate
        const nonFuelSalesGrouped = {};
        nonFuelSalesByItem.forEach(row => {
            const key = row.gst_rate || '0%';
            if (!nonFuelSalesGrouped[key]) nonFuelSalesGrouped[key] = [];
            nonFuelSalesGrouped[key].push(row);
        });

        Object.keys(nonFuelSalesGrouped).sort().forEach(gstRate => {
            salesSheet.getCell(`A${currentRow}`).value = `NON-FUEL SALES - GST @ ${gstRate}`;
            salesSheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
            currentRow++;

            const nonFuelSalesHeaderRow = salesSheet.getRow(currentRow);
            nonFuelSalesHeaderRow.values = ['Product', 'Quantity', 'Amount', 'CGST', 'SGST', 'Total GST'];
            nonFuelSalesHeaderRow.font = { bold: true };
            nonFuelSalesHeaderRow.eachCell((cell) => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
            });
            currentRow++;

            nonFuelSalesGrouped[gstRate].forEach(row => {
                const dataRow = salesSheet.getRow(currentRow);
                dataRow.getCell(1).value = row.product_name;
                dataRow.getCell(2).value = toNumber(row.total_qty);
                dataRow.getCell(3).value = toNumber(row.total_amount);
                dataRow.getCell(4).value = toNumber(row.total_cgst);
                dataRow.getCell(5).value = toNumber(row.total_sgst);
                dataRow.getCell(6).value = toNumber(row.total_cgst) + toNumber(row.total_sgst);
                for (let i = 2; i <= 6; i++) dataRow.getCell(i).numFmt = '#,##0.00';
                dataRow.eachCell((cell) => {
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                });
                currentRow++;
            });
            currentRow++;
        });

        // Set column widths
        salesSheet.columns = [
            { width: 30 },
            { width: 15 },
            { width: 15 },
            { width: 15 },
            { width: 15 },
            { width: 15 }
        ];
        
        // ============================================
        // SHEET 2: PURCHASE
        // ============================================
        const purchaseSheet = workbook.addWorksheet('Purchase');
        currentRow = 1;
        
        // Title
        purchaseSheet.getCell(`A${currentRow}`).value = 'GST SUMMARY REPORT - PURCHASE';
        purchaseSheet.getCell(`A${currentRow}`).font = { bold: true, size: 14 };
        currentRow++;
        
        purchaseSheet.getCell(`A${currentRow}`).value = locationDetails.location_name;
        currentRow++;
        
        purchaseSheet.getCell(`A${currentRow}`).value = `Period: ${moment(fromDate).format('DD/MM/YYYY')} to ${moment(toDate).format('DD/MM/YYYY')}`;
        currentRow += 2;
        
        // Fuel Purchase Invoice Details
        purchaseSheet.getCell(`A${currentRow}`).value = 'FUEL PURCHASE INVOICE DETAILS';
        purchaseSheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
        currentRow++;
        
        const groupedFuelInvoices = purchaseData.reduce((acc, item) => {
            if (!acc[item.Product]) acc[item.Product] = [];
            acc[item.Product].push(item);
            return acc;
        }, {});
        
        Object.keys(groupedFuelInvoices).forEach(product => {
            purchaseSheet.getCell(`A${currentRow}`).value = `Product: ${product}`;
            purchaseSheet.getCell(`A${currentRow}`).font = { bold: true };
            currentRow++;
            
            const headerRow = purchaseSheet.getRow(currentRow);
            headerRow.values = ['Date', 'Invoice Number', 'Quantity', 'Amount'];
            headerRow.font = { bold: true };
            headerRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD3D3D3' }
                };
            });
            currentRow++;
            
            groupedFuelInvoices[product].forEach(inv => {
                const dataRow = purchaseSheet.getRow(currentRow);
                dataRow.getCell(1).value = inv.Date; // Text
                dataRow.getCell(2).value = inv['Invoice-Number']; // Text
                dataRow.getCell(3).value = toNumber(inv.Quantity); // Number
                dataRow.getCell(4).value = toNumber(inv.Amount); // Number
                
                dataRow.getCell(3).numFmt = '#,##0.00';
                dataRow.getCell(4).numFmt = '#,##0.00';
                
                dataRow.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                });
                currentRow++;
            });
            
            currentRow++;
        });
        
        // Oil Purchase Invoice Details
        purchaseSheet.getCell(`A${currentRow}`).value = 'OIL/LUBRICANTS PURCHASE INVOICE DETAILS';
        purchaseSheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
        currentRow++;
        
        const groupedOilInvoices = nonFuelPurchaseInvoices.reduce((acc, invoice) => {
            if (!acc[invoice.gst_category]) acc[invoice.gst_category] = [];
            acc[invoice.gst_category].push(invoice);
            return acc;
        }, {});
        
        Object.keys(groupedOilInvoices).forEach(gstCategory => {
            purchaseSheet.getCell(`A${currentRow}`).value = `GST @ ${gstCategory}`;
            purchaseSheet.getCell(`A${currentRow}`).font = { bold: true };
            currentRow++;
            
            const headerRow = purchaseSheet.getRow(currentRow);
            headerRow.values = ['Supplier Name', 'Supplier GSTIN', 'Product', 'Date', 'Invoice Number', 'Quantity', 'Amount'];
            headerRow.font = { bold: true };
            headerRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD3D3D3' }
                };
            });
            currentRow++;
            
            groupedOilInvoices[gstCategory].forEach(inv => {
                const dataRow = purchaseSheet.getRow(currentRow);
                dataRow.getCell(1).value = inv['Supplier Name']; // Text
                dataRow.getCell(2).value = inv['Supplier GSTIN']; // Text
                dataRow.getCell(3).value = inv.Product; // Text
                dataRow.getCell(4).value = inv.Date; // Text
                dataRow.getCell(5).value = inv['Invoice-Number']; // Text
                dataRow.getCell(6).value = toNumber(inv.Quantity); // Number
                dataRow.getCell(7).value = toNumber(inv.Amount); // Number
                
                dataRow.getCell(6).numFmt = '#,##0.00';
                dataRow.getCell(7).numFmt = '#,##0.00';
                
                dataRow.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                });
                currentRow++;
            });
            
            currentRow++;
        });
        
        // Set column widths
        purchaseSheet.columns = [
            { width: 25 },
            { width: 20 },
            { width: 25 },
            { width: 15 },
            { width: 18 },
            { width: 12 },
            { width: 15 }
        ];
        
        // Generate Excel file
        const buffer = await workbook.xlsx.writeBuffer();
        
        const formattedFromDate = moment(fromDate).format('DDMMYYYY');
        const formattedToDate = moment(toDate).format('DDMMYYYY');
        const filename = `GstSummary_${locationCode}_${formattedFromDate}_${formattedToDate}.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Error generating Excel export:', error);
        res.status(500).send('An error occurred while generating the Excel file.');
    }
  }


};
