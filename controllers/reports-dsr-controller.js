const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var DsrReportDao = require("../dao/report-dsr-dao");
var CashFlowReportDao = require("../dao/report-cashflow-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
const moment = require('moment');


module.exports = {
  getdsrReport: async (req, res) => {
    try {
      let locationCode = req.user.location_code;      
      const caller = req.body.caller;


      let fromDate = dateFormat(new Date(), "yyyy-mm-dd");   
      const closingDate = new Date(req.body.fromClosingDate); // Convert to a Date object   
     
      if(req.body.fromClosingDate) {
        fromDate = closingDate.toISOString().slice(0, 10); // remove the timestamp.
      }   

     

     

      let Readingstmtlist = [];
      let SalesSummarylist = [];
      let Collectionlist = [];
      let CreditSalelist = [];
      let CardSalelist = [];
      let CardSaleSummarylist = [];
      let CashSaleslist = [];
      let expenseList = [];
      let stockReceiptList = [];
      let creditReceiptList = [];
      let shiftSummaryList = [];            
      let Denomlist = [];  
      let bankTransactionlist = [];     
      let renderData = {};

      // First check if there is any closing records for the dat 
      const closingPromise= await DsrReportDao.getclosingid(locationCode, fromDate);

      

      if(closingPromise && closingPromise.length > 0)
      {

      // Fetch readings and sales summary concurrently
      
      const readingsPromise = DsrReportDao.getreadings(locationCode, fromDate);
      const salesSummaryPromise = DsrReportDao.getsalessummary(locationCode, fromDate);
      const collectionPromise = DsrReportDao.getcollection(locationCode, fromDate);
      const oilCollectionPromise =  DsrReportDao.getOilcollection(locationCode, fromDate);
      const creditSalesPromise = DsrReportDao.getcreditsales(locationCode, fromDate);
      const cardSalesPromise = DsrReportDao.getcardsales(locationCode, fromDate);
      const cardSalesSummaryPromise = DsrReportDao.getcardsalesSummary(locationCode, fromDate);
      const cashSalesSummaryPromise = DsrReportDao.getCashsales(locationCode, fromDate);
      const expensesPromise = DsrReportDao.getexpenses(locationCode, fromDate);
      const stockReceiptPromise = DsrReportDao.getstockreceipt(locationCode, fromDate);
      const creditReceiptPromise = DsrReportDao.getcreditreceipt(locationCode, fromDate);
      const shiftSummaryPromise =  DsrReportDao.getshiftsummary(locationCode, fromDate);
      const cashFlowTransPromise =  CashFlowReportDao.getCashflowTrans(locationCode, fromDate);
      const bankTransPromise =  CashFlowReportDao.getBankTransaction(locationCode, fromDate);
      const cashFlowDenomPromise =  CashFlowReportDao.getCashfowDenomination(locationCode, fromDate);
      
      


      // Wait for all promises to resolve
      const [readingsData, salesSummaryData,collectionData,oilCollectionData,creditSalesData,
             cardSalesData,cardSalesSummaryData,cashSalesData,expensesData,stockReceiptData,creditReceiptData,shiftSummaryData,
             cashflowData,denomData,bankTranData] = await Promise.all([readingsPromise, 
                                                                                                salesSummaryPromise,
                                                                                                collectionPromise,
                                                                                                oilCollectionPromise,
                                                                                                creditSalesPromise,
                                                                                                cardSalesPromise,
                                                                                                cardSalesSummaryPromise,
                                                                                                cashSalesSummaryPromise,
                                                                                                expensesPromise,
                                                                                                stockReceiptPromise,
                                                                                                creditReceiptPromise,
                                                                                                shiftSummaryPromise,
                                                                                                cashFlowTransPromise,                                                                                                
                                                                                                cashFlowDenomPromise,
                                                                                                bankTransPromise
                                                                                              ]);

      // Process readings data
      readingsData.forEach((readingData) => {
        Readingstmtlist.push({
          'Nozzle Code': readingData.pump_code,
          'Closing Reading': readingData.closing,
          'Opening Reading': readingData.opening,
          Testing: readingData.testing,
          Sale: readingData.sale,
        });
      });

      let cashSales = 0;

      // Process sales summary data
      salesSummaryData.forEach((salesSummary) => {

        
        cashSales = salesSummary.total_sales - salesSummary.credit_sales;

        SalesSummarylist.push({
          Product: salesSummary.product_code,
          'Nozzle Flow': salesSummary.nozzle_sales,
          'Testing': salesSummary.nozzle_test,
          'Total Sales': salesSummary.total_sales,
          'Credit Sales': salesSummary.credit_sales,
          'Cash Sales': cashSales.toFixed(2),
        });
      });


      let totalCash = 0;
      let totalCredit = 0;
      let totalCard = 0;
       // Process sales Collection data
       collectionData.forEach((salesCollection) => {

        const cashAmount = parseFloat(salesCollection.totalsalamt) - parseFloat(salesCollection.crsaleamtwithoutdisc)-parseFloat(salesCollection.cardsales);
        const creditAmount = parseFloat(salesCollection.crsaleamt);       
        const cardAmount = parseFloat(salesCollection.cardsales);

        

        // Accumulate totals
        totalCash += cashAmount;
        totalCredit += creditAmount;
        totalCard += cardAmount;
        
      });


      // Accumalate Oil collection

      let totalOilCash = 0;
      let totalOilCredit = 0;
       // Process sales Collection data
       oilCollectionData.forEach((oilCollection) => { 
     
        totalOilCash += parseFloat(oilCollection.oil_cash);
        totalOilCredit += parseFloat(oilCollection.oil_credit);    
        
      });

      console.log('totalOilCash'+totalOilCash);
      console.log('totalOilCredit'+totalOilCredit);

              // Add totals to the collection list
        Collectionlist.push({
         // Product: "Total",
          Cash: (totalCash+totalOilCash).toFixed(2), 
          Credit: (totalCredit+totalOilCredit).toFixed(2),
          Card: totalCard.toFixed(2)
        });

        let totalCreditSales = 0;
        

       // Process Credit Sales data
       creditSalesData.forEach((creditSales) => {
    
        totalCreditSales += parseFloat(creditSales.amt);


        CreditSalelist.push({
          'Bill No': creditSales.bill_no,
          'Credit Party': creditSales.name,
           Product: creditSales.product_name,
           Rate: creditSales.price,
           Quantity: creditSales.qty,
           Amount: creditSales.amt
        });
      });

        // Push the total amount after the loop
      CreditSalelist.push({
        'Bill No': 'Total',
        'Credit Party': '-',
        Product: '-',
        Rate: '-',
        Quantity: '-',
        Amount: totalCreditSales 
      });

      let totalCardSales = 0;

      // Process Card Sales data
      cardSalesData.forEach((cardSales) => {

        totalCardSales += parseFloat(cardSales.amt);

        CardSalelist.push({
          'Bill No': cardSales.bill_no,
          'Card': cardSales.name,
           Product: cardSales.product_name,
           Rate: cardSales.price,
           Quantity: cardSales.qty,
           Amount: cardSales.amt
        });
      });
      
       // Push the total amount after the loop
       CardSalelist.push({
        'Bill No': 'Total',
        'Credit Party': '-',
        Product: '-',
        Rate: '-',
        Quantity: '-',
        Amount: totalCardSales 
      });
    
      let totalCardSummarySales = 0;

     cardSalesSummaryData.forEach((cardSummarySales) => {

        totalCardSummarySales += parseFloat(cardSummarySales.amt);

        CardSaleSummarylist.push({          
          'Card': cardSummarySales.name,           
           Amount: cardSummarySales.amt
        });
      });
      
       // Push the total amount after the loop
       CardSaleSummarylist.push({        
        'Credit Party': 'Total',        
        Amount: totalCardSummarySales 
      });
     
      let totalCashSales = 0;   

      

      cashSalesData.forEach((cashSales) => {

        totalCashSales += parseFloat(cashSales.amt);

        CashSaleslist.push({
           Product: cashSales.product_name,
           Quantity: cashSales.qty,
           Price: cashSales.price,
           Discount: cashSales.discount,
           Amount: cashSales.amt,
        });
      });

        // Push the total amount after the loop
        CashSaleslist.push({
          Product: 'Total',
          Quantity: '-',
          Price: '-',
          Discount: '-',
          Amount: totalCashSales,
        }); 


      let totalExpenses = 0; 
      // Process expenses data
      expensesData.forEach((expense) => {

        totalExpenses += parseFloat(expense.amount);

        expenseList.push({
          'Name': expense.expense_name,
           Amount: expense.amount,
           Notes: expense.notes
        });
      });
        
       // Push the total amount after the loop
      expenseList.push({
        'Name': 'Total',
         Amount: totalExpenses,
         Notes: '-'
      });


      // Process Stock Receipt data 
      stockReceiptData.forEach((stockreceipt) => {
        stockReceiptList.push({
          'Decant Date': stockreceipt.decant_date,
          'Decant Time': stockreceipt.decant_time,
          'Truck Number': stockreceipt.truck_number,
          'Odometer Reading': stockreceipt.odometer_reading,
           Driver: stockreceipt.driver,
           Helper: stockreceipt.helper,
           'Decant Incharge': stockreceipt.decant_incharge,
           Product: stockreceipt.product,  // Key needs to be dynamically derived
           'Invoice Number': stockreceipt.invoice_number,
           'Invoice Amount': stockreceipt.invoice_amount,
        });
      });


      creditReceiptData.forEach((creditreceipt) => {
        creditReceiptList.push({
          'Receipt No': creditreceipt.receipt_no,
          'Date': creditreceipt.receipt_date,
          'Customer Name': creditreceipt.name,
          'Type': creditreceipt.receipt_type,
          'Amount': creditreceipt.amount,
          'Notes': creditreceipt.notes,
        });
      });

      shiftSummaryData.forEach((shiftsummary) => {
        const keyValue = {};
      
        // Handle known columns directly
        keyValue['Date'] = shiftsummary.closing_date_formatted;
        keyValue['Name'] = shiftsummary.person_name;        
      
        // Handle unknown columns dynamically (for product sales data)
        Object.keys(shiftsummary).forEach((key) => {
          // Skip already handled known columns
          if (!['person_name', 'closing_date_formatted','loose','ex_short'].includes(key)) {
            keyValue[key] = shiftsummary[key];
          }
        });
        keyValue['2T Loose'] = shiftsummary.loose;
        keyValue['Excess/Shortage'] = shiftsummary.ex_short;
      
        // Push the created key-value pair object to shiftSummaryList
        shiftSummaryList.push(keyValue);
        
      });

      // Initialize the Cashflowstmtlist array and variables to sum credits and debits
      let Cashflowstmtlist = [];
      let totalCredits = 0;
      let totalDebits = 0;


      // Fetch cash flow transactions
    
      cashflowData.forEach((cashflowData) => {
        Cashflowstmtlist.push({
          Transaction: cashflowData.type,
          Description: cashflowData.description,
          Credit: cashflowData.credit,
          Debit: cashflowData.debit,
        });
  
       // Sum the credits and debits
        totalCredits += parseFloat(cashflowData.credit) || 0; // Use parseFloat to ensure numbers are summed
        totalDebits += parseFloat(cashflowData.debit) || 0; // Use parseFloat to ensure numbers are summed  
         


      });


        // After the loop, push the totals into the Cashflowstmtlist
        Cashflowstmtlist.push({
          Transaction: "Total",
          Description: "-",
          Credit: totalCredits,
          Debit: totalDebits
        });

      // Calculate the result of credits - debits
      let cashflowresult = totalCredits - totalDebits;

       // Fetch cash flow denominations
       let totaldenomamount = 0;
       
       denomData.forEach((denomData) => {
         Denomlist.push({
           denomination: denomData.denomination,
           denomcount: denomData.denomcount,
           amount: denomData.amount,
         });

         totaldenomamount = totaldenomamount+denomData.amount;
         
        });

        let resultList = [];  // This will hold both the cashflowresult and TotalDenomAmount

        resultList.push({
          'Denomination Amount': cashflowresult.toFixed(2),
          'Excess/Shortage': (cashflowresult-totaldenomamount).toFixed(2)
        });

        

        const groupedTransactions = bankTranData.reduce((acc, transaction) => {
          if (!acc[transaction.bank_account]) {
            acc[transaction.bank_account] = [];
          }
          acc[transaction.bank_account].push(transaction);
          return acc;
        }, {});
 
      
        const formattedFromClosingDate = moment(fromDate).format('DD/MM/YYYY (dddd)');

      // Prepare the render data
      renderData ={
        title: 'DSR Report',
        user: req.user,
        fromClosingDate: fromDate,
        formattedFromClosingDate: formattedFromClosingDate,
        closingData: 'Available', 
        readinglist: Readingstmtlist,
        salessummarylist: SalesSummarylist,
        collectionlist: Collectionlist,
        creditsaleslist: CreditSalelist,
        cardsalelist: CardSalelist,
        CardSaleSummarylist: CardSaleSummarylist,
        CashSaleslist: CashSaleslist,
        expenselist: expenseList,
        stockreceiptlist: stockReceiptList,
        creditReceiptList: creditReceiptList,
        shiftSummaryList: shiftSummaryList,
        Cashflowstmtlist: Cashflowstmtlist,
        DenomResult: resultList,
        bankTransactionlist: groupedTransactions,
      }
    }else
    {
      renderData ={
        title: 'DSR Report',
        user: req.user,
        fromClosingDate: fromDate,
        closingData: 'Not Available'        
      }

    }

      // Render the appropriate response
      if (caller === 'notpdf') {
        res.render('reports-dsr', renderData);
      } else {
        return new Promise((resolve, reject) => {
          res.render('reports-dsr', renderData, (err, html) => {
            if (err) {
              console.error('getdsrReport: Error in res.render:', err);
              reject(err);
            } else {
              console.log('getdsrReport: Successfully rendered HTML');
              resolve(html);
            }
          });
        });
      }
    } catch (error) {
      console.error('Error fetching DSR Report data:', error);
      res.status(500).send('An error occurred while generating the DSR report.');
    }
  },
};
