const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");
const moment = require('moment');

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
              
                  if (creditstmtData.product_name !== null) {
                    // Debit transaction (purchases increase the balance)
                    runningBalance += transactionAmount;
                    totalDebits += transactionAmount;
                  } else {
                    // Credit transaction (payments reduce the balance)
                    runningBalance -= transactionAmount;
                    totalCredits += transactionAmount;
                  }

                  
              
                  Creditstmtlist.push({
                    Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),
                    Particulars: creditstmtData.bill_no,
                    companyName: creditstmtData.company_name,
                    Debit: creditstmtData.product_name !== null ? transactionAmount : null,
                    Credit: creditstmtData.product_name === null ? transactionAmount : null,
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
              
                  if (creditstmtData.product_name !== null) {
                    // Debit transaction (purchases increase the balance)
                    runningBalance += transactionAmount;
                    totalDebits += transactionAmount;
                  } else {
                    // Credit transaction (payments reduce the balance)
                    runningBalance -= transactionAmount;
                    totalCredits += transactionAmount;
                    
                  }
              
                  Creditstmtlist.push({
                    Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),                                
                    Particulars: creditstmtData.bill_no,
                    companyName: creditstmtData.company_name,
                    Product: creditstmtData.product_name,
                    Price: creditstmtData.price,
                    "Price Discount": creditstmtData.price_discount,
                    Qty: creditstmtData.qty,
                    Debit: creditstmtData.product_name !== null ? transactionAmount : null,
                    Credit: creditstmtData.product_name === null ? transactionAmount : null, 
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
                       
                           if (creditstmtData.product_name !== null) {
                              // Debit transaction (purchases increase the balance)
                              runningBalance += transactionAmount; 
                              totalDebits += transactionAmount;
                             
                           } else {
                             // Credit transaction (payments reduce the balance)
                             runningBalance -= transactionAmount;
                             totalCredits += transactionAmount;
                           }
         
                           
                       
                           Creditstmtlist.push({
                             Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),
                             Particulars: creditstmtData.bill_no,
                             companyName: creditstmtData.company_name,
                             Debit: creditstmtData.product_name !== null ? transactionAmount : null,
                             Credit: creditstmtData.product_name === null ? transactionAmount : null,
                             Narration: creditstmtData.notes,
                             Balance: runningBalance, // Updated balance calculation
                           });
                         });
                       }
                       else {  
                         let runningBalance = Number(OpeningBal); // Ensure it's a number
                          
                       
                         data1.forEach((creditstmtData) => {
                           let transactionAmount = Number(creditstmtData.amount); // Convert amount to number
                       
                           if (creditstmtData.product_name !== null) {
                             // Debit transaction (purchases increase the balance)
                             runningBalance += transactionAmount;
                              totalDebits += transactionAmount;
                           } else {
                             // Credit transaction (payments reduce the balance)
                             runningBalance -= transactionAmount;
                              totalCredits += transactionAmount;
                           }
                       
                           Creditstmtlist.push({
                             Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),                                
                             Particulars: creditstmtData.bill_no,
                             companyName: creditstmtData.company_name,
                             Product: creditstmtData.product_name,
                             Price: creditstmtData.price,
                             "Price Discount": creditstmtData.price_discount,
                             Qty: creditstmtData.qty,
                             Debit: creditstmtData.product_name !== null ? transactionAmount : null,
                             Credit: creditstmtData.product_name === null ? transactionAmount : null, 
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
       const closingDate = new Date(req.body.toClosingDate); // Convert to a Date object   
      
       if(req.body.toClosingDate) {
         toDate = closingDate.toISOString().slice(0, 10); // remove the timestamp.
       }   

       const Creditsummarylist = [];
          let serialNumber = 1;  // Initialize serial number counter

          const data = await ReportDao.getDayBalance(locationCode, toDate);

          data.forEach((creditSummaryData) => {
            // Check if ClosingData is not between -10 and 10
            if (creditSummaryData.ClosingData < -10 || creditSummaryData.ClosingData > 10) {
              Creditsummarylist.push({
                'S.no': serialNumber++,  // Increment serial number
                'Credit Customer': creditSummaryData.company_name,
                'Balance': creditSummaryData.ClosingData
              });
            }
          });

          const formattedtoDate = moment(toDate).format('DD/MM/YYYY');
                        

       if(caller=='notpdf') {          
                      
                  res.render('reports-creditsummary', {title: 'Credit Summary Reports', user: req.user,toClosingDate: toDate,formattedtoDate:formattedtoDate, creditsummary: Creditsummarylist});
                 
                  
          } else
          {                
                
                return new Promise((resolve, reject) => {
                  res.render('reports-creditsummary', {title: 'Credit Summary Reports', user: req.user,toClosingDate: toDate,formattedtoDate:formattedtoDate, creditsummary: Creditsummarylist},
                     (err, html) => {
                      if (err) {
                        console.error('getCreditSummaryReport: Error in res.render:', err);
                        reject(err); // Reject the promise if there's an error
                      } else {
                        console.log('getCreditSummaryReport: Successfully rendered HTML');
                        resolve(html); // Resolve the promise with the HTML content
                      }
                  });
                }); 
               

          }
  },
  getSalesSummaryReport: async(req, res) => {
    //console.log(req);
     let locationCode = req.user.location_code;
     let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
     let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    
     let caller = req.body.caller;
     
   

     
     if(req.body.fromClosingDate) {
       fromDate =req.body.fromClosingDate;
     }
     if(req.body.toClosingDate) {
       toDate = req.body.toClosingDate;
     }
     let Saleslist=[];     
     let renderData = {};

      
             
           


           const data1 = await ReportDao.getSales(locationCode, fromDate,toDate);

       
           data1.forEach((salesSummary) => {
            const keyValue = {};
          
            // Handle known columns directly
            keyValue['Date'] = salesSummary.closing_date_formatted;
                 
          
            // Handle unknown columns dynamically (for product sales data)
            Object.keys(salesSummary).forEach((key) => {
              // Skip already handled known columns
              if (!['closing_date_formatted','loose'].includes(key)) {
                keyValue[key] = salesSummary[key];
              }
            });

            // Add the '2T Loose' column
            keyValue['2T Loose'] = salesSummary.loose;  

            // Push the created key-value pair object to shiftSummaryList
            Saleslist.push(keyValue);
            
          });

          // Compute totals for each column (excluding the 'Date' column)
    if (Saleslist.length > 0) {
      const totals = {};
      Saleslist.forEach((row) => {
        for (const key in row) {
          if (key === 'Date') continue;
          // Convert values to numbers; if not a number, treat as 0.
          totals[key] = (totals[key] || 0) + Number(row[key] || 0);
        }
      });

      // Create a new row for totals.
      const totalRow = { 'Date': 'Total' };
      Object.keys(totals).forEach((key) => {
        totalRow[key] = totals[key];
      });
      // Append the total row to the Saleslist.
      Saleslist.push(totalRow);
    }
      
                     const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
                     const formattedToDate = moment(toDate).format('DD/MM/YYYY'); 
                     
                       // Prepare the render data
                   renderData ={
                     title: 'Sales Summary Reports', 
                     user: req.user, 
                     fromClosingDate: fromDate,
                     toClosingDate: toDate, 
                     formattedFromDate: formattedFromDate,
                     formattedToDate: formattedToDate,
                     Saleslist: Saleslist,                                   
                  
                   }

                 if(caller=='notpdf') {
                 res.render('report-sales-summary',renderData);
                 }else
                 {                
             
                   return new Promise((resolve, reject) => {
                     res.render('report-sales-summary',renderData,
                        (err, html) => {
                         if (err) {
                           console.error('getSalesSummaryReport: Error in res.render:', err);
                           reject(err); // Reject the promise if there's an error
                         } else {
                           console.log('getSalesSummaryReport: Successfully rendered HTML');
                           resolve(html); // Resolve the promise with the HTML content
                         }
                     });
                   }); 
                  
   
             }
 
 
 
           }

}
        