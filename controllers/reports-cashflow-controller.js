const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const CashflowReportDao = require("../dao/report-cashflow-dao");
const bankAccountController = require("./bankaccount-mgmt-controller");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");

module.exports = {
  getCashFlowReport: async (req, res) => {
    try {
      // Extract user location and request data
      const locationCode = req.user.location_code;
      let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
      const caller = req.body.caller;

      if (req.body.cfclosingDate) {
        console.log(`Received closing date: ${req.body.cfclosingDate}`);
        fromDate = req.body.cfclosingDate;
      }

      // Initialize data lists
      const Cashflowstmtlist = [];
      const Denomlist = [];
      let TotalDenomAmount = 0;

      // Fetch cash flow transactions
      const data = await CashflowReportDao.getCashflowTrans(locationCode, fromDate);
      data.forEach((cashflowData) => {
        Cashflowstmtlist.push({
          tranType: cashflowData.type,
          description: cashflowData.description,
          credit: cashflowData.credit,
          debit: cashflowData.debit,
        });
      });

      // Fetch cash flow denominations
      const denomData = await CashflowReportDao.getCashfowDenomination(locationCode, fromDate);
      denomData.forEach((denomData) => {
        Denomlist.push({
          denomination: denomData.denomination,
          denomcount: denomData.denomcount,
          amount: denomData.amount,
        });

        

        TotalDenomAmount = TotalDenomAmount+denomData.amount;
      });

      console.log(TotalDenomAmount)

       const bankDetails = await CashflowReportDao.getBankAccounts(locationCode,fromDate);  

       // Initialize the array to hold the results
       let bankTransactions = [];

       for (let i = 0; i < bankDetails.length; i++) {
        const account = bankDetails[i];
        const accountNickname = account.account_nickname;
        const accountId = account.bank_id;
  
        // Second query: Get transactions for each account
        const transactionDetails = await CashflowReportDao.getBankTransaction(locationCode, fromDate, accountId);
  
        // Combine the results into a single array
        bankTransactions.push({
          accountNickname: accountNickname, 
          accountId: accountId,         
          transactions: transactionDetails
        });
      }

      console.log(bankTransactions);



      // Prepare the render data
      const renderData = {
        title: 'Cashflow Report',
        user: req.user,
        cfclosingDate: fromDate,
        cashflowstmt: Cashflowstmtlist,
        denomination: Denomlist,
        TotalDenom: TotalDenomAmount,
        bankTransactions: bankTransactions
      };

      // Render the appropriate response
      if (caller === 'notpdf') {
        res.render('reports-cashflow', renderData);
      } else {
        return new Promise((resolve, reject) => {
          res.render('reports-cashflow', renderData, (err, html) => {
            if (err) {
              console.error('getCashFlowReport: Error in res.render:', err);
              reject(err);
            } else {
              console.log('getCashFlowReport: Successfully rendered HTML');
              resolve(html);
            }
          });
        });
      }
    } catch (error) {
      console.error('getCashFlowReport: Unexpected error:', error);
      res.status(500).send('An error occurred while generating the report.');
    }
  },
};
