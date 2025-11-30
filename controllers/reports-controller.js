const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");
const moment = require('moment');
const locationConfig = require('../utils/location-config');

module.exports = {
     getCreditReport: async(req, res) => {
       //console.log(req);
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
       // let cname = req.body.company_name;
        let cid;
        let route;

        console.log('getCreditReport: User Role:', req.user.Role);
        console.log('getCreditReport: User Creditlist ID:', req.user.creditlist_id);

        if(req.user.Role === 'Customer'){
          cid = req.user.creditlist_id;
          route = 'reports-customer-facing';
        }
        else{
          cid = req.body.company_id;
          route = 'reports';
        }
        let caller = req.body.caller;
        let reportType = req.body.reportType;
        

        if (reportType == 'Creditledger'){
          route = 'reports-credit-ledger';
        }

        
        if(req.body.fromClosingDate) {
          fromDate =req.body.fromClosingDate;
        }
        if(req.body.toClosingDate) {
          toDate = req.body.toClosingDate;
        }
        let Creditstmtlist=[];
        let credits = [];
        let OpeningBal;
        let closingBal;
        let totalDebits = 0;
        let totalCredits = 0;
        let renderData = {};

        CreditDao.findAll(locationCode)
        .then(data => {
            // If the user is a Customer, filter credits based on their `creditlist_id`
            data.forEach((credit) => {
                if (req.user.Role === 'Customer') {
                    // Only include credit data that matches the logged-in user's creditlist_id
                    if (credit.creditlist_id === cid) {  // Exclude Digital (card_flag === 'Y')
                        credits.push({
                            id: credit.creditlist_id,
                            name: credit.Company_Name
                        });
                    }
                } else {
                    // For non-Customer roles, you can apply other filters or show data differently
                    if (!(credit.card_flag === 'Y')) {  // Exclude Digital (card_flag === 'Y')
                        credits.push({
                            id: credit.creditlist_id,
                            name: credit.Company_Name
                        });
                    }
                }
            })
          });
                
              const data = await  ReportDao.getBalance(cid, fromDate,toDate);
              OpeningBal = data[0].OpeningData;
              closingBal = data[0].ClosingData;


              const data1 = await ReportDao.getCreditStmt(locationCode, fromDate,toDate,cid);

              if (reportType == 'Creditledger') {
                let runningBalance = Number(OpeningBal); // Ensure it's a number                
              
                data1.forEach((creditstmtData) => {
                  let transactionAmount = Number(creditstmtData.amount); // Convert amount to number                  
              
                     // Use transaction_type field for clean, explicit logic
                      switch(creditstmtData.transaction_type) {
                          case 'SALE':
                          case 'ADJUSTMENT_DEBIT':
                              // Debit transactions - increase balance (like sales)
                              runningBalance += transactionAmount;
                              totalDebits += transactionAmount;
                              break;
                              
                          case 'RECEIPT':
                          case 'ADJUSTMENT_CREDIT':
                              // Credit transactions - decrease balance (like payments)
                              runningBalance -= transactionAmount;
                              totalCredits += transactionAmount;
                              break;
                              
                          default:
                              // Handle unexpected transaction types (fallback)
                              console.warn('Unknown transaction type:', creditstmtData.transaction_type);
                              // You could add logic here or treat as one type
                              break;
                      }

                  
              
                  Creditstmtlist.push({
                    Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),
                    Particulars: creditstmtData.bill_no,
                    companyName: creditstmtData.company_name,
                    Debit: (creditstmtData.transaction_type === 'SALE' || creditstmtData.transaction_type === 'ADJUSTMENT_DEBIT') ? transactionAmount : null,
                    Credit: (creditstmtData.transaction_type === 'RECEIPT' || creditstmtData.transaction_type === 'ADJUSTMENT_CREDIT') ? transactionAmount : null,
                    Narration: creditstmtData.notes,
                    Balance: runningBalance, // Updated balance calculation
                  });
                });
              }
              else {  
                let runningBalance = Number(OpeningBal); // Ensure it's a number     
                 
                  // Helper function to format odometer reading with Indian number format
                const formatOdometerReading = (reading) => {
                  if (!reading || reading === null) return '';
                  const formatted = new Intl.NumberFormat('en-IN', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  }).format(reading);
                  return formatted + ' km';
                };
                


                data1.forEach((creditstmtData) => {
                  let transactionAmount = Number(creditstmtData.amount); // Convert amount to number                      
              
                                    // Use transaction_type field for clean, explicit logic
                        switch(creditstmtData.transaction_type) {
                            case 'SALE':
                            case 'ADJUSTMENT_DEBIT':
                                // Debit transactions - increase balance (like sales)
                                runningBalance += transactionAmount;
                                totalDebits += transactionAmount;
                                break;
                                
                            case 'RECEIPT':
                            case 'ADJUSTMENT_CREDIT':
                                // Credit transactions - decrease balance (like payments)
                                runningBalance -= transactionAmount;
                                totalCredits += transactionAmount;
                                break;
                                
                            default:
                                // Handle unexpected transaction types (fallback)
                                console.warn('Unknown transaction type:', creditstmtData.transaction_type);
                                // You could add logic here or treat as one type
                                break;
                        }
              
                  Creditstmtlist.push({
                    Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),                                
                    Particulars: creditstmtData.bill_no,
                    companyName: creditstmtData.company_name,
                    Product: creditstmtData.product_name,
                    Price: creditstmtData.price,
                    "Price Discount": creditstmtData.price_discount,
                    Qty: creditstmtData.qty,
                    Debit: (creditstmtData.transaction_type === 'SALE' || creditstmtData.transaction_type === 'ADJUSTMENT_DEBIT') ? transactionAmount : null,
                    Credit: (creditstmtData.transaction_type === 'RECEIPT' || creditstmtData.transaction_type === 'ADJUSTMENT_CREDIT') ? transactionAmount : null,                
                    Narration: creditstmtData.notes,
                    Balance: runningBalance,
                    'Odometer Reading': formatOdometerReading(creditstmtData.odometer_reading),
                    'Vehicle Number': creditstmtData.vehicle_number,
                  });
                });


              }
              
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
                        credits: credits, 
                        company_id: cid,
                        creditstmt: Creditstmtlist,
                        openingbalance: OpeningBal,
                        closingbalance: closingBal,
                        cidparam: cid, 
                        totalDebits: totalDebits,
                        totalCredits: totalCredits
                      }

                    if(caller=='notpdf') {
                    res.render(route,renderData);
                    }else
                    {                
                
                      return new Promise((resolve, reject) => {
                        res.render(route,renderData,
                           (err, html) => {
                            if (err) {
                              console.error('getCreditReport: Error in res.render:', err);
                              reject(err); // Reject the promise if there's an error
                            } else {
                              console.log('getCreditReport: Successfully rendered HTML');
                              resolve(html); // Resolve the promise with the HTML content
                            }
                        });
                      }); 
                     
      
                }
    
    
    
              },
    getApiCreditReport: async(req, res) => {
                console.log(req);

                

                 let locationCode = req.body.location_code;
                 let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
                 let toDate = dateFormat(new Date(), "yyyy-mm-dd");
                // let cname = req.body.company_name;
                 let cid;
                 let route;
                 let totalDebits = 0;
                 let totalCredits = 0;
         
             
         
                 if(req.body.Role === 'Customer'){
                   cid = req.body.creditlist_id;
                   route = 'reports-customer-facing';
                 }
                 else{
                   cid = req.body.company_id;
                   route = 'reports';
                 }
                 let caller = req.body.caller;
                 let reportType = req.body.reportType;
                 
         
                 if (reportType == 'Creditledger'){
                   route = 'reports-credit-ledger';
                 }
         
                 
                 if(req.body.fromClosingDate) {
                   fromDate =req.body.fromClosingDate;
                 }
                 if(req.body.toClosingDate) {
                   toDate = req.body.toClosingDate;
                 }
                 let Creditstmtlist=[];
                 let credits = [];
                 let OpeningBal;
                 let closingBal;
                 let renderData = {};
         
                 CreditDao.findAll(locationCode)
                 .then(data => {
                     // If the user is a Customer, filter credits based on their `creditlist_id`
                     data.forEach((credit) => {
                         if (req.user.Role === 'Customer') {
                             // Only include credit data that matches the logged-in user's creditlist_id
                             if (credit.creditlist_id === cid) {  // Exclude Digital (card_flag === 'Y')
                                 credits.push({
                                     id: credit.creditlist_id,
                                     name: credit.Company_Name
                                 });
                             }
                         } else {
                             // For non-Customer roles, you can apply other filters or show data differently
                             if (!(credit.card_flag === 'Y')) {  // Exclude Digital (card_flag === 'Y')
                                 credits.push({
                                     id: credit.creditlist_id,
                                     name: credit.Company_Name
                                 });
                             }
                         }
                     })
                   });
                         
                       const data = await  ReportDao.getBalance(cid, fromDate,toDate);
                       OpeningBal = data[0].OpeningData;
                       closingBal = data[0].ClosingData;
         
         
                       const data1 = await ReportDao.getCreditStmt(locationCode, fromDate,toDate,cid);
         
                       if (reportType == 'Creditledger') {
                         let runningBalance = Number(OpeningBal);                          
                       
                         data1.forEach((creditstmtData) => {
                           let transactionAmount = Number(creditstmtData.amount); 
                       
                             // Use transaction_type field for clean, explicit logic
                              switch(creditstmtData.transaction_type) {
                                  case 'SALE':
                                  case 'ADJUSTMENT_DEBIT':
                                      // Debit transactions - increase balance (like sales)
                                      runningBalance += transactionAmount;
                                      totalDebits += transactionAmount;
                                      break;
                                      
                                  case 'RECEIPT':
                                  case 'ADJUSTMENT_CREDIT':
                                      // Credit transactions - decrease balance (like payments)
                                      runningBalance -= transactionAmount;
                                      totalCredits += transactionAmount;
                                      break;
                                      
                                  default:
                                      // Handle unexpected transaction types (fallback)
                                      console.warn('Unknown transaction type:', creditstmtData.transaction_type);
                                      // You could add logic here or treat as one type
                                      break;
                              }
                           
                       
                           Creditstmtlist.push({
                             Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),
                             Particulars: creditstmtData.bill_no,
                             companyName: creditstmtData.company_name,
                             Debit: (creditstmtData.transaction_type === 'SALE' || creditstmtData.transaction_type === 'ADJUSTMENT_DEBIT') ? transactionAmount : null,
                             Credit: (creditstmtData.transaction_type === 'RECEIPT' || creditstmtData.transaction_type === 'ADJUSTMENT_CREDIT') ? transactionAmount : null,  
                             Narration: creditstmtData.notes,
                             Balance: runningBalance, // Updated balance calculation
                           });
                         });
                       }
                       else {  
                         let runningBalance = Number(OpeningBal); // Ensure it's a number
                          
                       
                         data1.forEach((creditstmtData) => {
                           let transactionAmount = Number(creditstmtData.amount); // Convert amount to number
                       
                              // Use transaction_type field for clean, explicit logic
                            switch(creditstmtData.transaction_type) {
                                case 'SALE':
                                case 'ADJUSTMENT_DEBIT':
                                    // Debit transactions - increase balance (like sales)
                                    runningBalance += transactionAmount;
                                    totalDebits += transactionAmount;
                                    break;
                                    
                                case 'RECEIPT':
                                case 'ADJUSTMENT_CREDIT':
                                    // Credit transactions - decrease balance (like payments)
                                    runningBalance -= transactionAmount;
                                    totalCredits += transactionAmount;
                                    break;
                                    
                                default:
                                    // Handle unexpected transaction types (fallback)
                                    console.warn('Unknown transaction type:', creditstmtData.transaction_type);
                                    // You could add logic here or treat as one type
                                    break;
                            }
                       
                           Creditstmtlist.push({
                             Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),                                
                             Particulars: creditstmtData.bill_no,
                             companyName: creditstmtData.company_name,
                             Product: creditstmtData.product_name,
                             Price: creditstmtData.price,
                             "Price Discount": creditstmtData.price_discount,
                             Qty: creditstmtData.qty,
                             Debit: (creditstmtData.transaction_type === 'SALE' || creditstmtData.transaction_type === 'ADJUSTMENT_DEBIT') ? transactionAmount : null,
                             Credit: (creditstmtData.transaction_type === 'RECEIPT' || creditstmtData.transaction_type === 'ADJUSTMENT_CREDIT') ? transactionAmount : null,
                             Narration: creditstmtData.notes,
                             Balance: runningBalance // Updated balance
                           });
                         });
                       }
                       
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
                                 credits: credits, 
                                 company_id: cid,
                                 creditstmt: Creditstmtlist,
                                 openingbalance: OpeningBal,
                                 closingbalance: closingBal,
                                 cidparam: cid, 
                                 totalDebits: totalDebits,
                                 totalCredits: totalCredits 
                               }
         
                             if(caller=='notpdf') {
                              res.status(200).json({renderData})                            
                             }else
                             {                
                         
                                 res.status(200).json({renderData})                                 
                              
                         }
             
             
             
                       },          

getCreditSummaryReport: async(req, res) => {
   
   let locationCode = req.user.location_code;  
   let caller = req.body.caller;     
   
   let toDate = dateFormat(new Date(), "yyyy-mm-dd");   
   const closingDate = new Date(req.body.toClosingDate);
  
   if(req.body.toClosingDate) {
     toDate = closingDate.toISOString().slice(0, 10);
   }

   // Get credit terms from config
   const defaultCreditDays = await locationConfig.getLocationConfigValue(
       locationCode, 
       'DEFAULT_CREDIT_DAYS', 
       '30'  // default to 30 days if not configured
   );

   const Creditsummarylist = [];
   let serialNumber = 1;

   const data = await ReportDao.getDayBalance(locationCode, toDate);

   data.forEach((creditSummaryData) => {
     if (creditSummaryData.ClosingData < -10 || creditSummaryData.ClosingData > 10) {
       
       // Determine if overdue
       const daysOverdue = creditSummaryData.days_since_payment !== null ? 
           creditSummaryData.days_since_payment - parseInt(defaultCreditDays) : 0;
       
       const isOverdue = daysOverdue > 0;
       
       Creditsummarylist.push({
         'S.no': serialNumber++,
         'Credit Customer': creditSummaryData.company_name,
         'Balance': creditSummaryData.ClosingData,
         'Last Receipt Date': creditSummaryData.last_payment_date ? 
             moment(creditSummaryData.last_payment_date).format('DD/MM/YYYY') : '-',
         'Last Receipt Amount': creditSummaryData.last_payment_amount ? 
             parseFloat(creditSummaryData.last_payment_amount) : '-',
         'Days Since Receipt': creditSummaryData.days_since_payment !== null ? 
             creditSummaryData.days_since_payment : '-',
         '_isOverdue': isOverdue,  // Flag for frontend
         '_daysOverdue': daysOverdue > 0 ? daysOverdue : 0
       });
     }
   });

   const formattedtoDate = moment(toDate).format('DD/MM/YYYY');

   if(caller=='notpdf') {          
       res.render('reports-creditsummary', {
           title: 'Credit Summary Reports', 
           user: req.user,
           toClosingDate: toDate,
           formattedtoDate: formattedtoDate, 
           creditsummary: Creditsummarylist,
           creditTermsDays: defaultCreditDays  // Pass to template
       });
   } else {
       return new Promise((resolve, reject) => {
         res.render('reports-creditsummary', {
             title: 'Credit Summary Reports', 
             user: req.user,
             toClosingDate: toDate,
             formattedtoDate: formattedtoDate, 
             creditsummary: Creditsummarylist,
             creditTermsDays: defaultCreditDays
         }, (err, html) => {
           if (err) {
             console.error('getCreditSummaryReport: Error in res.render:', err);
             reject(err);
           } else {
             console.log('getCreditSummaryReport: Successfully rendered HTML');
             resolve(html);
           }
         });
       }); 
   }
},

getSalesSummaryReport: async(req, res) => {
    let locationCode = req.user.location_code;
    let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    
    let caller = req.body.caller;
    let viewType = req.body.viewType || 'daily'; // 'daily' or 'monthly'
    
    if(req.body.fromClosingDate) {
        fromDate = req.body.fromClosingDate;
    }
    if(req.body.toClosingDate) {
        toDate = req.body.toClosingDate;
    }
    
    let Saleslist = [];     
    let renderData = {};

    // Fetch data based on view type
    let data1;
    if (viewType === 'monthly') {
        data1 = await ReportDao.getMonthlySales(locationCode, fromDate, toDate);
    } else {
        data1 = await ReportDao.getSales(locationCode, fromDate, toDate);
    }

    // Process the data
    data1.forEach((salesSummary) => {
        const keyValue = {};
        
        // Handle date column based on view type
        if (viewType === 'monthly') {
            keyValue['Month'] = salesSummary.month_formatted;
        } else {
            keyValue['Date'] = salesSummary.closing_date_formatted;
            
            // ADD DAY COLUMN FOR DAILY VIEW
            const dateObj = new Date(salesSummary.closing_date_formatted.split('-').reverse().join('-'));
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            keyValue['Day'] = dayNames[dateObj.getDay()];
        }
        
        // Handle unknown columns dynamically (for product sales data)
        Object.keys(salesSummary).forEach((key) => {
            // Skip already handled known columns
            if (!['closing_date_formatted', 'month_formatted', 'month_key', 'loose'].includes(key)) {
                keyValue[key] = salesSummary[key];
            }
        });

        // Add the '2T Loose' column
        keyValue['2T Loose'] = salesSummary.loose;  

        // Push the created key-value pair object to Saleslist
        Saleslist.push(keyValue);
    });

    // Compute totals for each column (excluding the 'Date'/'Month'/'Day' column)
    if (Saleslist.length > 0) {
        const totals = {};
        Saleslist.forEach((row) => {
            for (const key in row) {
                if (key === 'Date' || key === 'Month' || key === 'Day') continue;
                // Convert values to numbers; if not a number, treat as 0.
                totals[key] = (totals[key] || 0) + Number(row[key] || 0);
            }
        });

        // Create a new row for totals
        const totalRow = viewType === 'monthly' ? { 'Month': 'Total' } : { 'Date': 'Total', 'Day': '' };
        Object.keys(totals).forEach((key) => {
            totalRow[key] = totals[key];
        });
        // Append the total row to the Saleslist
        Saleslist.push(totalRow);
    }
    
    const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
    const formattedToDate = moment(toDate).format('DD/MM/YYYY'); 
    
    // Prepare the render data
    renderData = {
        title: 'Sales Summary Reports', 
        user: req.user, 
        fromClosingDate: fromDate,
        toClosingDate: toDate, 
        formattedFromDate: formattedFromDate,
        formattedToDate: formattedToDate,
        Saleslist: Saleslist,
        viewType: viewType // Pass viewType to pug
    }

    if(caller == 'notpdf') {
        res.render('report-sales-summary', renderData);
    } else {                
        return new Promise((resolve, reject) => {
            res.render('report-sales-summary', renderData,
                (err, html) => {
                    if (err) {
                        console.error('getSalesSummaryReport: Error in res.render:', err);
                        reject(err);
                    } else {
                        console.log('getSalesSummaryReport: Successfully rendered HTML');
                        resolve(html);
                    }
                });
        }); 
    }
},



getApiCreditReport1: async (req, res) => {
  try {
    // Extract data directly from verified JWT
    const locationCode = req.user.location_code;
    const role = req.user.role;
    const cid = req.user.creditlist_id; // For Customer
    const username = req.user.username;

    // Default filters
    const fromDate = req.body.fromClosingDate || dateFormat(new Date(), "yyyy-mm-dd");
    const toDate = req.body.toClosingDate || dateFormat(new Date(), "yyyy-mm-dd");

    let totalDebits = 0;
    let totalCredits = 0;
    let Creditstmtlist = [];
    let OpeningBal = 0;
    let closingBal = 0;

    // Fetch credit list
    const creditData = await CreditDao.findAll(locationCode);
    const credits = creditData
      .filter((c) => !(c.card_flag === "Y"))
      .map((c) => ({ id: c.creditlist_id, name: c.Company_Name }));

    // Determine company ID
    const companyId = role === "Customer" ? cid : req.body.company_id;

    // Fetch balances
    const balanceData = await ReportDao.getBalance(companyId, fromDate, toDate);
    OpeningBal = balanceData?.[0]?.OpeningData || 0;
    closingBal = balanceData?.[0]?.ClosingData || 0;

    // Fetch statement data
    const transactions = await ReportDao.getCreditStmt(locationCode, fromDate, toDate, companyId);
    let runningBalance = Number(OpeningBal);

    transactions.forEach((t) => {
      const amount = Number(t.amount || 0);

      switch (t.transaction_type) {
        case "SALE":
        case "ADJUSTMENT_DEBIT":
          runningBalance += amount;
          totalDebits += amount;
          break;
        case "RECEIPT":
        case "ADJUSTMENT_CREDIT":
          runningBalance -= amount;
          totalCredits += amount;
          break;
      }

      Creditstmtlist.push({
        Date: dateFormat(t.tran_date, "dd-mm-yyyy"),
        Particulars: t.bill_no,
        companyName: t.company_name,
        Product: t.product_name,
        Price: t.price,
        "Price Discount": t.price_discount,
        Qty: t.qty,
        Debit: ["SALE", "ADJUSTMENT_DEBIT"].includes(t.transaction_type) ? amount : null,
        Credit: ["RECEIPT", "ADJUSTMENT_CREDIT"].includes(t.transaction_type) ? amount : null,
        Narration: t.notes,
        Balance: runningBalance,
      });
    });

    const formattedFromDate = moment(fromDate).format("DD/MM/YYYY");
    const formattedToDate = moment(toDate).format("DD/MM/YYYY");

    // Final JSON payload
    const result = {
      username,
      role,
      locationCode,
      company_id: companyId,
      fromDate: formattedFromDate,
      toDate: formattedToDate,
      openingBalance: OpeningBal,
      closingBalance: closingBal,
      totalDebits,
      totalCredits,
      transactions: Creditstmtlist,
      credits,
    };

    res.status(200).json(result);
  } catch (err) {
    console.error("getApiCreditReport error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

}
        