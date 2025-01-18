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
        let cid = req.body.company_id;
        let caller = req.body.caller;
        let reportType = req.body.reportType;
        let route = 'reports';

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
                data.forEach((credit) => {
                  if (!(credit.card_flag === 'Y')) {  // condition to ignore Digital.
                    credits.push({
                      id: credit.creditlist_id,
                      name: credit.Company_Name
                    });
                  }
                });
              });
                
              const data = await  ReportDao.getBalance(cid, fromDate,toDate);
              OpeningBal = data[0].OpeningData;
              closingBal = data[0].ClosingData;


              const data1 = await ReportDao.getCreditStmt(locationCode, fromDate,toDate,cid);

            if(reportType == 'Creditledger'){
              data1.forEach((creditstmtData) => {
                Creditstmtlist.push({
                Date: dateFormat(creditstmtData.tran_date,"dd-mm-yyyy"),                                
                "Bill No/Receipt No.": creditstmtData.bill_no,
                companyName: creditstmtData.company_name,                
                Debit:creditstmtData.product_name !== null ? creditstmtData.amount : null,
                Credit:creditstmtData.product_name === null ? creditstmtData.amount : null,           
                Narration: creditstmtData.notes
                });
              });  
            }
            else {  
              data1.forEach((creditstmtData) => {
                                Creditstmtlist.push({
                                Date: dateFormat(creditstmtData.tran_date,"dd-mm-yyyy"),                                
                                "Bill No/Receipt No.": creditstmtData.bill_no,
                                companyName: creditstmtData.company_name,
                                Product: creditstmtData.product_name,
                                Price: creditstmtData.price,
                                "Price Discount": creditstmtData.price_discount,
                                Qty: creditstmtData.qty,
                                Amount: creditstmtData.amount,
                                Narration: creditstmtData.notes                                
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
                      }

                    if(caller=='notpdf') {
                    res.render(route,renderData);
                    }else
                    {                
                
                      return new Promise((resolve, reject) => {
                        res.render(route,renderData,
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
  }
}
        