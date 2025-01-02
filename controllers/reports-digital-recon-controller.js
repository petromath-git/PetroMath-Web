const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");
const moment = require('moment');

module.exports = {
  getDigitalReconReport: async (req, res) => {
    //console.log(req);
    let locationCode = req.user.location_code;
    let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    let cid = req.body.company_id;
    let caller = req.body.caller;


    if (req.body.fromClosingDate) {
      fromDate = req.body.fromClosingDate;
    }
    if (req.body.toClosingDate) {
      toDate = req.body.toClosingDate;
    }
    let Creditstmtlist = [];
    let credits = [];
    let OpeningBal;
    let closingBal;
    let renderData = {};

    CreditDao.findAll(locationCode)
      .then(data => {
        data.forEach((credit) => {
          if (credit.card_flag === 'Y') {
            credits.push({
              id: credit.creditlist_id,
              name: credit.Company_Name
            });
          }
        });
      });

    const data = await ReportDao.getBalance(cid, fromDate, toDate);
    OpeningBal = data[0].OpeningData;
    closingBal = data[0].ClosingData;


    // Create extended dates for query
    const queryFromDate = new Date(fromDate);
    queryFromDate.setDate(queryFromDate.getDate() - 3);

    const queryToDate = new Date(toDate);
    queryToDate.setDate(queryToDate.getDate() + 3);

    // Get extended data for reconciliation
    const data1 = await ReportDao.getCreditStmt(
      locationCode,
      dateFormat(queryFromDate, "yyyy-mm-dd"),
      dateFormat(queryToDate, "yyyy-mm-dd"),
      cid
    );

    // Create full dataset for reconciliation
    const fullDataset = data1.map((creditstmtData) => ({
      Date: dateFormat(creditstmtData.tran_date, "dd-mm-yyyy"),
      "Bill No/Receipt No.": creditstmtData.bill_no,
      companyName: creditstmtData.company_name,
      Debit: creditstmtData.product_name !== null ? creditstmtData.amount : null,
      Credit: creditstmtData.product_name === null ? creditstmtData.amount : null,
      Narration: creditstmtData.notes
    }));

    function findMatchingTransactions(transactions) {
      const TOLERANCE = 100; // 100 rupees tolerance

      const processedData = transactions.map(tx => ({
        ...tx,
        Date: new Date(tx.Date.split('-').reverse().join('-')),
        Debit: tx.Debit ? parseFloat(tx.Debit.replace(/,/g, '')) : null,
        Credit: tx.Credit ? parseFloat(tx.Credit.replace(/,/g, '')) : null,
        reconciled: false // Add reconciled flag
      }));

      const creditTransactions = processedData.filter(tx => tx.Credit !== null);
      const matches = [];
      const matchedDebitIds = new Set();

      // Function to get all combinations of debits (2 to N debits)
      function getCombinations(arr, size) {
        const combinations = [];
        const helper = (start, currentCombo) => {
          if (currentCombo.length === size) {
            combinations.push([...currentCombo]);
            return;
          }
          for (let i = start; i < arr.length; i++) {
            currentCombo.push(arr[i]);
            helper(i + 1, currentCombo);
            currentCombo.pop();
          }
        };
        helper(0, []);
        return combinations;
      }

      creditTransactions.forEach(creditTx => {
        const creditDate = creditTx.Date;
        const creditAmount = creditTx.Credit;
        const currentDateStr = creditDate.toISOString().split('T')[0];

        const prevDate = new Date(creditDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];

        const relevantDebits = processedData.filter(tx =>
          tx.Debit !== null &&
          !matchedDebitIds.has(tx['Bill No/Receipt No.']) &&
          [currentDateStr, prevDateStr].includes(tx.Date.toISOString().split('T')[0])
        );

        // Check combinations of 2 to N debits
        for (let i = 2; i <= relevantDebits.length; i++) {
          const combinations = getCombinations(relevantDebits, i);
          for (const combo of combinations) {
            const sum = combo.reduce((acc, debit) => acc + debit.Debit, 0);
            if (Math.abs(sum - creditAmount) <= TOLERANCE) {  // Using tolerance
              matches.push({
                creditDate: dateFormat(creditDate, "dd-mm-yyyy"),
                creditAmount: creditAmount,
                matchingDebits: combo,
                totalDebits: sum
              });

              // Mark the debits as reconciled
              combo.forEach(debit => {
                debit.reconciled = true;
                matchedDebitIds.add(debit['Bill No/Receipt No.']);
              });
              creditTx.reconciled = true;

              return;  // Stop after finding the first match within tolerance
            }
          }
        }
      });

      return { matches, matchedDebitIds };
    }


    // Get matches
    const { matches: reconciliationMatches, matchedDebitIds } = findMatchingTransactions(fullDataset);

    Creditstmtlist = fullDataset
      .filter(record => {
        const recordDate = new Date(record.Date.split('-').reverse().join('-'));
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        return recordDate >= startDate && recordDate <= endDate;
      })
      .map(transaction => ({
        ...transaction,
        reconciled: transaction.Credit !== null ?
          reconciliationMatches.some(m =>
            m.creditDate === transaction.Date &&
            Math.abs(parseFloat(transaction.Credit.replace(/,/g, '')) - m.totalDebits) <= 100  // Same tolerance
          ) :
          matchedDebitIds.has(transaction['Bill No/Receipt No.'])
      }));


    const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
    const formattedToDate = moment(toDate).format('DD/MM/YYYY');

    // Prepare the render data
    renderData = {
      title: 'Digital Reconciliation',
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

    if (caller == 'notpdf') {
      res.render('reports-digital-recon', renderData);
    } else {

      return new Promise((resolve, reject) => {
        res.render('reports-digital-recon', renderData,
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
