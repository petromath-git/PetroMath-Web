const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");

module.exports = {
     getCreditReport: (req, res) => {
       //console.log(req);
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
       // let cname = req.body.company_name;
        let cid = req.body.company_id;
        
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

        CreditDao.findAll(locationCode)
            .then(data => {
                data.forEach((credit) => {
                    credits.push({
                        id: credit.creditlist_id,
                        name: credit.Company_Name
                    });
                });
              });
                

            ReportDao.getBalance(cid, fromDate,toDate)
              .then((data) => {OpeningBal = data[0].OpeningData;
                               closingBal = data[0].ClosingData;                              
                             //  console.log(closingBal); 
              
                              });      

        //console.log(fromDate,toDate,cname);
            ReportDao.getCreditStmt(locationCode, fromDate,toDate,cid)
                    .then(data => {
                        data.forEach((creditstmtData) => {
                                Creditstmtlist.push({
                                tranDate: dateFormat(creditstmtData.tran_date,"dd-mm-yyyy"),
                                locationCode: creditstmtData.location_code,
                                billno: creditstmtData.bill_no,
                                companyName: creditstmtData.company_name,
                                productName: creditstmtData.product_name,
                                price: creditstmtData.price,
                                price_discount: creditstmtData.price_discount,
                                quantity: creditstmtData.qty,
                                amount: creditstmtData.amount,
                                notes: creditstmtData.notes
                            });
                        });
                    res.render('reports', {title: 'Reports', user: req.user, fromClosingDate: fromDate,toClosingDate: toDate, credits: credits, company_id: cid,creditstmt: Creditstmtlist,openingbalance: OpeningBal,closingbalance: closingBal });
                    });
    },
    getCreditSummaryReport: (req, res) => {
      //console.log(req);
       let locationCode = req.user.location_code;      
       let toDate = dateFormat(new Date(), "yyyy-mm-dd");   
       const closingDate = new Date(req.body.toClosingDate); // Convert to a Date object   
      
       if(req.body.toClosingDate) {
         toDate = closingDate.toISOString().slice(0, 10); // remove the timestamp.
       }

      // console.log(req.body.toClosingDate);
      // console.log(closingDate);
      // console.log(toDate);

       let Creditsummarylist=[];
               

       //console.log(fromDate,toDate,cname);
           ReportDao.getDayBalance(locationCode,toDate)
                   .then(data => {
                       data.forEach((creditSummaryData) => {
                           Creditsummarylist.push({
                               'CreditParty':creditSummaryData.company_name,
                               'Outstanding':creditSummaryData.ClosingData
                           });
                         //console.log(creditSummaryData.ClosingData)

                       });
                   res.render('reports-creditsummary', {title: 'Credit Summary Reports', user: req.user,toClosingDate: toDate, creditsummary: Creditsummarylist});
                   });
   } 
}
        