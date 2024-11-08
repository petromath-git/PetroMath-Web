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
        let cname = req.body.company_name;
        
        if(req.body.fromClosingDate) {
          fromDate =req.body.fromClosingDate;
        }
        if(req.body.toClosingDate) {
          toDate = req.body.toClosingDate;
        }
        let Creditstmtlist=[];
        let credits = [];
        CreditDao.findAll(locationCode)
            .then(data => {
                data.forEach((credit) => {
                    credits.push({
                        id: credit.creditlist_id,
                        name: credit.Company_Name
                    });
                });
              });
                
        //console.log(fromDate,toDate,cname);
        ReportDao.getCreditStmt(locationCode, fromDate,toDate,cname)
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
                    res.render('reports', {title: 'Reports', user: req.user, fromClosingDate: fromDate,toClosingDate: toDate, credits: credits, company_name: cname,creditstmt: Creditstmtlist });
                    });
    }
}
        