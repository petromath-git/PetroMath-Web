const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");
const moment = require('moment');

module.exports = {
  getDigitalReconReport: async (req, res) => {
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
    const data1 = await ReportDao.getDigitalStmt(
      locationCode,
      dateFormat(queryFromDate, "yyyy-mm-dd"),
      dateFormat(queryToDate, "yyyy-mm-dd"),
      cid
    );

    // Create full dataset for reconciliation - WITH UNIQUE ID
    const fullDataset = data1.map((creditstmtData, index) => ({
      unique_id: `${index}`,
      Date: creditstmtData.tran_date,
      bill_no: creditstmtData.bill_no,
      Narration: [creditstmtData.bill_no, creditstmtData.notes]
        .filter(Boolean)
        .join(" - "),
      companyName: creditstmtData.company_name,
      entry_type: creditstmtData.entry_type,
      Debit: creditstmtData.entry_type === 'DEBIT' ? creditstmtData.amount : null,
      Credit: creditstmtData.entry_type === 'CREDIT' ? creditstmtData.amount : null
    }));

    function findMatchingTransactions(transactions) {
      const TOLERANCE = 100;

      const processedData = transactions.map(tx => ({
        ...tx,
        DateObj: new Date(tx.Date.split('-').reverse().join('-')),
        DebitAmount: tx.Debit ? parseFloat(tx.Debit) : null,
        CreditAmount: tx.Credit ? parseFloat(tx.Credit) : null,
        reconciled: false,
        match_id: null
      }));

      const creditTransactions = processedData.filter(tx => tx.CreditAmount !== null);
      const matches = [];
      const matchedDebitIds = new Set();
      let matchCounter = 1;

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
        const creditDate = creditTx.DateObj;
        const creditAmount = creditTx.CreditAmount;
        const currentDateStr = creditDate.toISOString().split('T')[0];

        const prevDate = new Date(creditDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];

        const nextDate = new Date(creditDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const relevantDebits = processedData.filter(tx =>
          tx.DebitAmount !== null &&
          !matchedDebitIds.has(tx.unique_id) &&
          [prevDateStr, currentDateStr, nextDateStr].includes(tx.DateObj.toISOString().split('T')[0])
        );

        // Try single debit match first
        for (const debit of relevantDebits) {
          if (Math.abs(debit.DebitAmount - creditAmount) <= TOLERANCE) {
            const currentMatchId = matchCounter++;
            
            matches.push({
              match_id: currentMatchId,
              creditDate: creditTx.Date,
              creditAmount: creditAmount,
              creditBillNo: creditTx.bill_no,
              matchingDebits: [debit],
              totalDebits: debit.DebitAmount
            });
            
            debit.reconciled = true;
            debit.match_id = currentMatchId;
            creditTx.reconciled = true;
            creditTx.match_id = currentMatchId;
            matchedDebitIds.add(debit.unique_id);
            return;
          }
        }

        // Try combinations of 2 to N debits
        for (let i = 2; i <= Math.min(relevantDebits.length, 5); i++) {
          const combinations = getCombinations(relevantDebits, i);
          for (const combo of combinations) {
            const sum = combo.reduce((acc, debit) => acc + debit.DebitAmount, 0);
            if (Math.abs(sum - creditAmount) <= TOLERANCE) {
              const currentMatchId = matchCounter++;
              
              matches.push({
                match_id: currentMatchId,
                creditDate: creditTx.Date,
                creditAmount: creditAmount,
                creditBillNo: creditTx.bill_no,
                matchingDebits: combo,
                totalDebits: sum
              });

              combo.forEach(debit => {
                debit.reconciled = true;
                debit.match_id = currentMatchId;
                matchedDebitIds.add(debit.unique_id);
              });
              creditTx.reconciled = true;
              creditTx.match_id = currentMatchId;

              return;
            }
          }
        }
      });

      return { matches, matchedDebitIds, processedData };
    }

    // Get matches
    const { matches: reconciliationMatches, matchedDebitIds, processedData } = findMatchingTransactions(fullDataset);

    // Filter to date range and map reconciliation status
    Creditstmtlist = processedData
      .filter(record => {
        const recordDate = record.DateObj;
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        return recordDate >= startDate && recordDate <= endDate;
      })
      .map(transaction => ({
        Date: transaction.Date,
        Narration: transaction.Narration,
        companyName: transaction.companyName,
        Debit: transaction.Debit,
        Credit: transaction.Credit,
        reconciled: transaction.reconciled,
        match_id: transaction.match_id
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
              console.error('getDigitalReconReport: Error in res.render:', err);
              reject(err);
            } else {
              console.log('getDigitalReconReport: Successfully rendered HTML');
              resolve(html);
            }
          });
      });
    }
  }
}