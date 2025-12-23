const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var DsrReportDao = require("../dao/report-dsr-dao");
var personDao = require("../dao/person-dao");
var CashFlowReportDao = require("../dao/report-cashflow-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
const moment = require('moment');
var locationdao = require("../dao/report-dao");
var ReportDao = require("../dao/report-dao");
const locationConfig = require('../utils/location-config');


module.exports = {
  getdsrReport: async (req, res) => {
    try {
      let locationCode = req.body.locationCode||req.user.location_code;      // get from selected location.
      const caller = req.body.caller;
      const personId = req.user.Person_id;

      const locationDetails = await locationdao.getLocationDetails(locationCode);

      // Fetch skipped reading config
      const showSkippedReadingDsr = await locationConfig.getLocationConfigValue(
          locationCode,
          'SHOW_SKIPPED_READING_DSR',
          'N' // default value if not configured
      );

      

      console.log('getdsrReport: personId:', personId);


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
      let FuelTankStocklist= [];   
      let personLocations= [];
      let productPriceList= [];
      let monthlyOfftakeList= [];
      let deadlineList= [];
      let renderData = {};


      const personLocationPromise =  await personDao.findUserLocations(personId);

      // Process Person Location Data
     personLocationPromise.forEach((locations) => {
       personLocations.push({
           'LocationCodes': locations.location_code,           
       });
     });
      

      // First check if there is any closing records for the date 
      const closingPromise= await DsrReportDao.getclosingid(locationCode, fromDate);
      const dayClosePromise= await DsrReportDao.getDayClose(locationCode, fromDate);
     
      

      if(dayClosePromise && dayClosePromise.length>0 && closingPromise && closingPromise.length > 0)
      {

      // Fetch readings and sales summary concurrently
      
      const readingsPromise = DsrReportDao.getreadings(locationCode, fromDate);
      const salesSummaryPromise = DsrReportDao.getsalessummary(locationCode, fromDate);
      const collectionPromise = DsrReportDao.getcollection(locationCode, fromDate);
      const digitalcollectionPromise = DsrReportDao.getDigitalSales(locationCode, fromDate);
      const oilCollectionPromise =  DsrReportDao.getOilcollection(locationCode, fromDate);
      const creditSalesPromise = DsrReportDao.getcreditsales(locationCode, fromDate);      
      const cardSalesSummaryPromise = DsrReportDao.getcardsalesSummary(locationCode, fromDate);
      const cashSalesSummaryPromise = DsrReportDao.getCashsales(locationCode, fromDate);
      const expensesPromise = DsrReportDao.getexpenses(locationCode, fromDate);
      const stockReceiptPromise = DsrReportDao.getstockreceipt(locationCode, fromDate);
      const creditReceiptPromise = DsrReportDao.getcreditreceipt(locationCode, fromDate);
      const shiftSummaryPromise =  DsrReportDao.getshiftsummary(locationCode, fromDate);
      const cashFlowTransPromise =  CashFlowReportDao.getCashflowTrans(locationCode, fromDate);
      const bankTransPromise =  CashFlowReportDao.getBankTransaction(locationCode, fromDate);
      const cashFlowDenomPromise =  CashFlowReportDao.getCashfowDenomination(locationCode, fromDate);
      const fuelTankStockPromise =  DsrReportDao.getfuelstock(locationCode, fromDate);
      const productPricePromise   =  DsrReportDao.getPumpPrice(locationCode, fromDate);
      const monthlyOfftakePromise = DsrReportDao.getMonthlyOfftake(locationCode, fromDate);
      const deadlinePromise = DsrReportDao.getDeadline(locationCode, fromDate);
      const skippedReadingsPromise = DsrReportDao.getSkippedReadings(locationCode, fromDate);
      


      // Wait for all promises to resolve
      const [readingsData, salesSummaryData,collectionData,digitalData,oilCollectionData,creditSalesData,
             cardSalesSummaryData,cashSalesData,expensesData,stockReceiptData,creditReceiptData,shiftSummaryData,
             cashflowData,denomData,bankTranData,fuelTankStockData,productPriceData,monthlyOfftakeData,deadlineData,skippedReadingsData] = await Promise.all([readingsPromise, 
                                                                                                salesSummaryPromise,
                                                                                                collectionPromise,
                                                                                                digitalcollectionPromise,
                                                                                                oilCollectionPromise,
                                                                                                creditSalesPromise,                                                                                                
                                                                                                cardSalesSummaryPromise,
                                                                                                cashSalesSummaryPromise,
                                                                                                expensesPromise,
                                                                                                stockReceiptPromise,
                                                                                                creditReceiptPromise,
                                                                                                shiftSummaryPromise,
                                                                                                cashFlowTransPromise,                                                                                                
                                                                                                cashFlowDenomPromise,
                                                                                                bankTransPromise,
                                                                                                fuelTankStockPromise,
                                                                                                productPricePromise,
                                                                                                monthlyOfftakePromise,
                                                                                                deadlinePromise,
                                                                                                skippedReadingsPromise                                                                                                
                                                                                              ]);

      // Process readings data
      productPriceData.forEach((productPrice) => {
        productPriceList.push({
          'Product': productPrice.product_code,
          'Price': productPrice.price,          
        });
      });


      const getMonthName = (date) => {
        const options = { month: 'short', year:  'numeric' };
        return new Intl.DateTimeFormat('en-IN', options).format(date);
      };



      function getSafePreviousMonthDate(date) {
        const originalDay = date.getDate();
        const safeDate = new Date(date); 
        safeDate.setDate(1); // Set to 1st to avoid overflow issues
        safeDate.setMonth(safeDate.getMonth() - 1);
      
        const daysInMonth = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 0).getDate();
        safeDate.setDate(Math.min(originalDay, daysInMonth)); // Clamp to month's max day
      
        return safeDate;
      }

      

        // Calculate dates for current, last month, and last year
        const currentMonthName = getMonthName(closingDate);

        const lastMonthDate = getSafePreviousMonthDate(closingDate);
        const lastMonthName = getMonthName(lastMonthDate);

        const lastYearDate = new Date(closingDate);
        lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
        const lastYearMonthName = getMonthName(lastYearDate);

       

        let totalCurrentMonthOfftake = 0;
        let totalLastMonthOfftake = 0;
        let totalLastYearOfftake = 0;
        
        monthlyOfftakeData.forEach((monthlyOfftake) => {
          // Accumulate totals for each off-take field
          totalCurrentMonthOfftake += Number(monthlyOfftake.current_month_Offtake || 0);
          totalLastMonthOfftake += Number(monthlyOfftake.last_month_Offtake || 0);
          totalLastYearOfftake += Number(monthlyOfftake.last_year_Offtake || 0);
        
          monthlyOfftakeList.push({
            'Product': monthlyOfftake.product_code,
            [currentMonthName]: monthlyOfftake.current_month_Offtake,
            [lastMonthName]: monthlyOfftake.last_month_Offtake,
            [lastYearMonthName]: monthlyOfftake.last_year_Offtake
          });
        });
        
        // Add the totals to the list for each field
        monthlyOfftakeList.push({
          'Product': 'Total', // Label for the total row
          [currentMonthName]: totalCurrentMonthOfftake,
          [lastMonthName]: totalLastMonthOfftake,
          [lastYearMonthName]: totalLastYearOfftake
        });

       

      // Process readings data
      readingsData.forEach((readingData) => {
        Readingstmtlist.push({
          'Nozzle Code': readingData.pump_code,
          'Closing Reading': readingData.closing,
          'Opening Reading': readingData.opening,
           'Nozzle Flow': readingData.sale,
           Testing: readingData.testing,
           Sale: readingData.sale - readingData.testing,
        });
      });


      let skippedReadingsList = [];

      skippedReadingsData.forEach((skipped) => {
          skippedReadingsList.push({
            'Nozzle': skipped.pump_code,
            'Opening Reading': parseFloat(skipped.opening_reading).toFixed(3),
            'Expected Opening': parseFloat(skipped.expected_opening).toFixed(3),
            'Gap': parseFloat(skipped.reading_gap).toFixed(3),
          });
        });


      deadlineData.forEach((deadline) => {     
       

        deadlineList.push({
          'Date': deadline.deadline_date,
          'Day': deadline.day,
          'Message': deadline.message,                    
        });
      });

      let DigiandCashSales = 0;

      // Process sales summary data
      salesSummaryData.forEach((salesSummary) => {

        
        DigiandCashSales = salesSummary.total_sales - salesSummary.credit_sales;

        // Ensure both values are numbers before comparison
        // const actualTesting = Number(salesSummary.nozzle_test);  
        // const expectedTesting = Number(salesSummary.nozzle_count) * 5;

        // // Declare formattedTesting inside the loop for each row
        // let formattedTesting = actualTesting;

        // // Append '*' only if there's a mismatch
        // if (actualTesting !== expectedTesting) {
        //     formattedTesting = `***   ${actualTesting}   ***`; // Convert to string with an asterisk
        // }



        SalesSummarylist.push({
          Product: salesSummary.product_code,
          'Nozzle Count': salesSummary.nozzle_count,
          'Nozzle Flow': salesSummary.nozzle_sales,
          'Testing': salesSummary.nozzle_test,       
          'Total Sales': salesSummary.total_sales,
          'Credit Sales': salesSummary.credit_sales,          
          'Digital+Cash Sales': DigiandCashSales.toFixed(2),
        });
      });


      let totalCash = 0;
      let totalCredit = 0;
      let totalCard = 0;
       // Process sales Collection data
       collectionData.forEach((salesCollection) => {

        const cashAmount = parseFloat(salesCollection.totalsalamt) - parseFloat(salesCollection.crsaleamtwithoutdisc);
        const creditAmount = parseFloat(salesCollection.crsaleamt); 

     
         // Only add if valid numbers
          if (!isNaN(cashAmount)) totalCash += cashAmount;
          if (!isNaN(creditAmount)) totalCredit += creditAmount;
        
        
      });


      // Handle digital sales with proper validation
      if (digitalData && digitalData.digital_sales) {
        const digitalSales = parseFloat(digitalData.digital_sales);
        if (!isNaN(digitalSales)) {
          totalCard = digitalSales;
        }
      } 
      // Adjust totalCash to exclude digital sales
      totalCash = totalCash - totalCard;


      // Accumalate Oil collection

      let totalOilCash = 0;
      let totalOilCredit = 0;
       // Process sales Collection data
      // Process oil collection data
      oilCollectionData.forEach((oilCollection) => { 
        const oilCash = parseFloat(oilCollection.oil_cash);
        const oilCredit = parseFloat(oilCollection.oil_credit);
        
        if (!isNaN(oilCash)) totalOilCash += oilCash;
        if (!isNaN(oilCredit)) totalOilCredit += oilCredit;
      });

      const formatter = new Intl.NumberFormat('en-IN', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
        });

        const grandTotal = totalCash + totalOilCash + totalCard + totalCredit + totalOilCredit;

        // Add totals to the collection list with safe percentage calculation
        Collectionlist.push({         
          Cash: `${formatter.format(totalCash + totalOilCash)} (${grandTotal > 0 ? ((totalCash + totalOilCash) / grandTotal * 100).toFixed(2) : '0.00'}%)`,
          Digital: `${formatter.format(totalCard)} (${grandTotal > 0 ? (totalCard / grandTotal * 100).toFixed(2) : '0.00'}%)`,
          Credit: `${formatter.format(totalCredit + totalOilCredit)} (${grandTotal > 0 ? ((totalCredit + totalOilCredit) / grandTotal * 100).toFixed(2) : '0.00'}%)`,
          'Total Collection': formatter.format(grandTotal)
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
           Discount: creditSales.discount,
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
        Discount: '-',
        Amount: totalCreditSales 
      });

     
    
  let totalCardSummarySales = 0;

  cardSalesSummaryData.forEach((cardSummarySales) => {
      totalCardSummarySales += parseFloat(cardSummarySales.amt);

      CardSaleSummarylist.push({
          'Date': cardSummarySales.transaction_date,
          'Digital': cardSummarySales.name,           
          Amount: cardSummarySales.amt
      });
  });
    
  // Push the total amount after the loop
  CardSaleSummarylist.push({
      'Date': '-',
      'Digital': 'Total',        
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
        keyValue['Closing Date'] = shiftsummary.closing_date_formatted;
        keyValue['Cashier Name'] = shiftsummary.person_name;        
      
        // Handle unknown columns dynamically (for product sales data)
        Object.keys(shiftsummary).forEach((key) => {
          // Skip already handled known columns
          if (!['person_name', 'closing_date_formatted','loose','ex_short','notes'].includes(key)) {
            keyValue[key] = shiftsummary[key];
          }
        });
        keyValue['2T Loose'] = shiftsummary.loose;
        keyValue['Excess/Shortage'] = shiftsummary.ex_short;
        keyValue['Notes'] = shiftsummary.notes;
      
        // Push the created key-value pair object to shiftSummaryList
        shiftSummaryList.push(keyValue);
        
      });


      const Creditsummarylist = [];      
      let totalBalance = 0;  // Initialize total balance counter
      let count = 0;  // Counter for limiting entries on non-special days
      
      const fromDateObj = new Date(fromDate);  // Convert fromDate to Date object
      const dayOfMonth = fromDateObj.getDate();
      const lastDayOfMonth = new Date(fromDateObj.getFullYear(), fromDateObj.getMonth() + 1, 0).getDate(); // Get last day of the month
      
      const data = await ReportDao.getDayBalance(locationCode, fromDate);
      
      // Determine if all entries should be added or limited to 3
      const isSpecialDay = (dayOfMonth === 15 || dayOfMonth === lastDayOfMonth);
      
      data.forEach((creditSummaryData) => {
          // Convert ClosingData to number before adding
          const balance = Number(creditSummaryData.ClosingData);
          totalBalance += balance;
          

           // Calculate daily interest at 12% per annum
          const interestIncurred = (balance * 0.12) / 365;
      
          // If it's a special day, push all data
          if (isSpecialDay && (creditSummaryData.ClosingData < -10 || creditSummaryData.ClosingData > 10)) {
              Creditsummarylist.push({
                  'Credit Customer': creditSummaryData.company_name,
                  'Balance': creditSummaryData.ClosingData,
                  'Notional Interest @ 12% (Today)': interestIncurred.toFixed(2)
              });
          } 
          // On other days, limit to 3 entries only
          else if ((creditSummaryData.ClosingData < -10 || creditSummaryData.ClosingData > 10) && count < 3) {
              Creditsummarylist.push({
                  'Credit Customer': creditSummaryData.company_name,
                  'Balance': creditSummaryData.ClosingData,
                  'Notional Interest @ 12% (Today)': interestIncurred.toFixed(2)
              });
              count++;
          }
      });
      
              // Add total as the last row
        Creditsummarylist.push({
          'Credit Customer': 'Total(All Customer Balances)',
          'Balance': totalBalance,
          'Notional Interest @ 12% (Today)': (totalBalance * 0.12 / 365).toFixed(2)
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
          InFlow: cashflowData.credit,
          OutFlow: cashflowData.debit,
        });
  
       // Sum the credits and debits
        totalCredits += parseFloat(cashflowData.credit) || 0; // Use parseFloat to ensure numbers are summed
        totalDebits += parseFloat(cashflowData.debit) || 0; // Use parseFloat to ensure numbers are summed  
         


      });


        // After the loop, push the totals into the Cashflowstmtlist
        Cashflowstmtlist.push({
          Transaction: "Total",
          Description: "-",
          InFlow: parseFloat(totalCredits.toFixed(2)),
          OutFlow: parseFloat(totalDebits.toFixed(2))
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
          'Cashflow Balance': cashflowresult.toFixed(2),
          'Denomination Total': totaldenomamount.toFixed(2),
          'Excess/Shortage': (totaldenomamount-cashflowresult).toFixed(2)
        });

        

        const groupedTransactions = bankTranData.reduce((acc, transaction) => {
          if (!acc[transaction.bank_account]) {
            acc[transaction.bank_account] = [];
          }
          acc[transaction.bank_account].push(transaction);
          return acc;
        }, {});


        fuelTankStockData.forEach((tankStock) => {        
          FuelTankStocklist.push({
             Tank: tankStock.tank,
             'Opening Stock': tankStock.opening,
             Receipts: tankStock.offtake,
             'Nozzle Flow': tankStock.sales,
             Testing: tankStock.testing,
             'Sales': tankStock.sales - tankStock.testing,
             'Closing Stock': tankStock.closing,
          });
        });

     
      
 
      
        const formattedFromClosingDate = moment(fromDate).format('DD/MM/YYYY (dddd)');

      // Prepare the render data
      renderData ={
        title: 'DSR Report',
        user: req.user,
        fromClosingDate: fromDate,
        formattedFromClosingDate: formattedFromClosingDate,
        closingData: 'Available', 
        personLocations: personLocations,
        locationName: locationDetails.location_name,
        locationCode: locationCode,
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
        FuelTankStocklist: FuelTankStocklist,
        productPriceList:productPriceList,
        monthlyOfftakeList: monthlyOfftakeList,
        deadlineList: deadlineList,
        Creditsummarylist:Creditsummarylist,
        showSkippedReadingDsr: showSkippedReadingDsr === 'Y',
        skippedReadingsList: skippedReadingsList,
        creditSummaryTitle: (dayOfMonth === 15 || dayOfMonth === lastDayOfMonth) 
        ? 'Credit Customer Balances (All Customers)' 
        : 'Credit Customer Balances (Top 3)'  // Pass title dynamically
      }
    }else
    {
      renderData ={
        title: 'DSR Report',
        user: req.user,
        fromClosingDate: fromDate,
        closingData: 'Not Available',
        personLocations: personLocations,
        locationName: locationDetails.location_name,
        locationCode: locationCode,        
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
