const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var GstSummaryDao = require("../dao/report-gst-summary-dao");
var CashFlowReportDao = require("../dao/report-cashflow-dao");
const moment = require('moment');


module.exports = {
  getgstsummaryReport: async (req, res) => {
    try {
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        let caller = req.body.caller;  // to know if this is for generating PDF or Serve to browser

        if(req.body.fromClosingDate) {
          fromDate =req.body.fromClosingDate;
        }
        if(req.body.toClosingDate) {
          toDate = req.body.toClosingDate;
        }


      let renderData = {};

  
      
      
        // Retrieve purchase data, fuel sales data, and non-fuel sales data concurrently.
        const purchaseDataPromise = GstSummaryDao.getpurchasesummary(locationCode, fromDate, toDate);
        const salesDataPromise = GstSummaryDao.getSalesConsolidated(locationCode, fromDate, toDate);
        const nonFuelSalesDataPromise = GstSummaryDao.getNonFuelSalesConsolidated(locationCode, fromDate, toDate);
  
        const [purchaseData, salesData, nonFuelSalesData] = await Promise.all([
          purchaseDataPromise,
          salesDataPromise,
          nonFuelSalesDataPromise
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
      
        const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
        const formattedToDate = moment(toDate).format('DD/MM/YYYY');

      // Prepare the render data
      renderData ={
        title: 'Reports', 
        user: req.user, 
        fromClosingDate: fromDate,
        toClosingDate: toDate, 
        formattedFromDate: formattedFromDate,
        formattedToDate: formattedToDate,            
        purchaseTransactionlist: groupedTransactions,
        salesSummaryList: salesSummaryList,
        nonFuelSalesSummaryList: nonFuelSalesSummaryList 
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
};
