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
        const purchaseConsolDataPromise = GstSummaryDao.getPurchaseSummaryConsolidated(locationCode, fromDate, toDate);
        const salesDataPromise = GstSummaryDao.getSalesConsolidated(locationCode, fromDate, toDate);
        const nonFuelSalesDataPromise = GstSummaryDao.getNonFuelSalesConsolidated(locationCode, fromDate, toDate);
  
        const [purchaseData,purchaseConsolData, salesData, nonFuelSalesData] = await Promise.all([
          purchaseDataPromise,
          purchaseConsolDataPromise,
          salesDataPromise,
          nonFuelSalesDataPromise
        ]);

      //  purchaseData is retrieved by calling getPurchaseSummaryConsolidated
      const purchaseSummaryList = [];
      purchaseConsolData.forEach((purchaseRow) => {
        purchaseSummaryList.push({
          'Product': purchaseRow.Product,               // The product name
          'Volume (Ltrs)': purchaseRow.Total_Quantity,    // Total quantity (already multiplied by 1000 as needed)
          'Amount': purchaseRow.Total_Amount             // Total purchase amount
        });
      });
        

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
        personLocations: personLocations,
        locationName: locationDetails.location_name,
        locationCode: locationCode,
        formattedFromDate: formattedFromDate,
        formattedToDate: formattedToDate,            
        purchaseTransactionlist: groupedTransactions,
        purchaseSummaryList: purchaseSummaryList,
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
