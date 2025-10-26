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
      const TOLERANCE = 1; // Reduced to Rs 1

      const processedData = transactions.map(tx => ({
        ...tx,
        DateObj: new Date(tx.Date.split('-').reverse().join('-')),
        DebitAmount: tx.Debit ? parseFloat(tx.Debit) : null,
        CreditAmount: tx.Credit ? parseFloat(tx.Credit) : null,
        reconciled: false,
        match_id: null,
        reconciliation_pass: null // Track which pass matched: 1 or 2
      }));

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

      // PASS 1: Standard reconciliation (±1 day)
      function firstPassReconciliation(creditTransactions, processedData, matchedDebitIds) {
        creditTransactions.forEach(creditTx => {
          if (creditTx.reconciled) return; // Skip if already matched

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

          // PRIORITY 1: Try EXACT single debit match first (difference = 0)
          for (const debit of relevantDebits) {
            if (Math.abs(debit.DebitAmount - creditAmount) === 0) {
              const currentMatchId = matchCounter++;
              
              debit.reconciled = true;
              debit.match_id = currentMatchId;
              debit.reconciliation_pass = 1;
              creditTx.reconciled = true;
              creditTx.match_id = currentMatchId;
              creditTx.reconciliation_pass = 1;
              matchedDebitIds.add(debit.unique_id);
              return;
            }
          }

          // PRIORITY 2: Try single debit match within tolerance
          for (const debit of relevantDebits) {
            if (Math.abs(debit.DebitAmount - creditAmount) <= TOLERANCE) {
              const currentMatchId = matchCounter++;
              
              debit.reconciled = true;
              debit.match_id = currentMatchId;
              debit.reconciliation_pass = 1;
              creditTx.reconciled = true;
              creditTx.match_id = currentMatchId;
              creditTx.reconciliation_pass = 1;
              matchedDebitIds.add(debit.unique_id);
              return;
            }
          }

          // PRIORITY 3: Try EXACT combinations of 2 to N debits
          for (let i = 2; i <= Math.min(relevantDebits.length, 5); i++) {
            const combinations = getCombinations(relevantDebits, i);
            for (const combo of combinations) {
              const sum = combo.reduce((acc, debit) => acc + debit.DebitAmount, 0);
              if (Math.abs(sum - creditAmount) === 0) {
                const currentMatchId = matchCounter++;
                
                combo.forEach(debit => {
                  debit.reconciled = true;
                  debit.match_id = currentMatchId;
                  debit.reconciliation_pass = 1;
                  matchedDebitIds.add(debit.unique_id);
                });
                creditTx.reconciled = true;
                creditTx.match_id = currentMatchId;
                creditTx.reconciliation_pass = 1;

                return;
              }
            }
          }

          // PRIORITY 4: Try combinations within tolerance
          for (let i = 2; i <= Math.min(relevantDebits.length, 5); i++) {
            const combinations = getCombinations(relevantDebits, i);
            for (const combo of combinations) {
              const sum = combo.reduce((acc, debit) => acc + debit.DebitAmount, 0);
              if (Math.abs(sum - creditAmount) <= TOLERANCE) {
                const currentMatchId = matchCounter++;
                
                combo.forEach(debit => {
                  debit.reconciled = true;
                  debit.match_id = currentMatchId;
                  debit.reconciliation_pass = 1;
                  matchedDebitIds.add(debit.unique_id);
                });
                creditTx.reconciled = true;
                creditTx.match_id = currentMatchId;
                creditTx.reconciliation_pass = 1;

                return;
              }
            }
          }
        });
      }

      // PASS 2: Extended reconciliation (±5 days) for unmatched transactions
      function secondPassReconciliation(creditTransactions, processedData, matchedDebitIds) {
        const unmatchedCredits = creditTransactions.filter(tx => !tx.reconciled);
        
        console.log(`Second pass: Attempting to match ${unmatchedCredits.length} unmatched credits with ±5 day range`);

        unmatchedCredits.forEach(creditTx => {
          const creditDate = creditTx.DateObj;
          const creditAmount = creditTx.CreditAmount;

          // Extended date range: ±5 days
          const fromDate = new Date(creditDate);
          fromDate.setDate(fromDate.getDate() - 5);
          
          const toDate = new Date(creditDate);
          toDate.setDate(toDate.getDate() + 5);

          const relevantDebits = processedData.filter(tx =>
            tx.DebitAmount !== null &&
            !matchedDebitIds.has(tx.unique_id) &&
            tx.DateObj >= fromDate &&
            tx.DateObj <= toDate
          );

          // Only try EXACT matches in second pass (no tolerance)
          // Try combinations of 2 to N debits
          for (let i = 1; i <= Math.min(relevantDebits.length, 10); i++) {
            if (i === 1) {
              // Single debit exact match
              for (const debit of relevantDebits) {
                if (Math.abs(debit.DebitAmount - creditAmount) === 0) {
                  const currentMatchId = matchCounter++;
                  
                  debit.reconciled = true;
                  debit.match_id = currentMatchId;
                  debit.reconciliation_pass = 2;
                  creditTx.reconciled = true;
                  creditTx.match_id = currentMatchId;
                  creditTx.reconciliation_pass = 2;
                  matchedDebitIds.add(debit.unique_id);
                  
                  console.log(`Second pass matched: Credit ${creditAmount} with single debit`);
                  return;
                }
              }
            } else {
              // Multiple debit exact match
              const combinations = getCombinations(relevantDebits, i);
              for (const combo of combinations) {
                const sum = combo.reduce((acc, debit) => acc + debit.DebitAmount, 0);
                if (Math.abs(sum - creditAmount) === 0) {
                  const currentMatchId = matchCounter++;
                  
                  combo.forEach(debit => {
                    debit.reconciled = true;
                    debit.match_id = currentMatchId;
                    debit.reconciliation_pass = 2;
                    matchedDebitIds.add(debit.unique_id);
                  });
                  creditTx.reconciled = true;
                  creditTx.match_id = currentMatchId;
                  creditTx.reconciliation_pass = 2;

                  console.log(`Second pass matched: Credit ${creditAmount} with ${combo.length} debits spanning multiple days`);
                  return;
                }
              }
            }
          }
        });
      }

      // PASS 3: Reverse matching - Single debit → Multiple credits (±5 days)
      function thirdPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds) {
        const unmatchedDebits = processedData.filter(tx => 
          tx.DebitAmount !== null && !matchedDebitIds.has(tx.unique_id)
        );
        
        console.log(`Third pass (Reverse): Attempting to match ${unmatchedDebits.length} unmatched debits with multiple credits`);

        unmatchedDebits.forEach(debitTx => {
          if (debitTx.reconciled) return; // Skip if already matched

          const debitDate = debitTx.DateObj;
          const debitAmount = debitTx.DebitAmount;

          // Extended date range: ±5 days
          const fromDate = new Date(debitDate);
          fromDate.setDate(fromDate.getDate() - 5);
          
          const toDate = new Date(debitDate);
          toDate.setDate(toDate.getDate() + 5);

          // Find unmatched credits within the date range
          const relevantCredits = creditTransactions.filter(tx =>
            !matchedCreditIds.has(tx.unique_id) &&
            tx.DateObj >= fromDate &&
            tx.DateObj <= toDate
          );

          // Only try EXACT matches (no tolerance) for combinations of 2 to N credits
          for (let i = 2; i <= Math.min(relevantCredits.length, 5); i++) {
            const combinations = getCombinations(relevantCredits, i);
            for (const combo of combinations) {
              const sum = combo.reduce((acc, credit) => acc + credit.CreditAmount, 0);
              
              // Check for exact match
              if (Math.abs(sum - debitAmount) === 0) {
                const currentMatchId = matchCounter++;
                
                // Mark the single debit
                debitTx.reconciled = true;
                debitTx.match_id = currentMatchId;
                debitTx.reconciliation_pass = 3;
                matchedDebitIds.add(debitTx.unique_id);
                
                // Mark multiple credits
                combo.forEach(credit => {
                  credit.reconciled = true;
                  credit.match_id = currentMatchId;
                  credit.reconciliation_pass = 3;
                  matchedCreditIds.add(credit.unique_id);
                });

                console.log(`Third pass (Reverse) matched: Debit ${debitAmount} with ${combo.length} credits (${combo.map(c => c.CreditAmount).join(' + ')} = ${sum})`);
                return;
              }
            }
          }
        });
      }

      const creditTransactions = processedData.filter(tx => tx.CreditAmount !== null);
      const matchedDebitIds = new Set();
      const matchedCreditIds = new Set();

      // Execute Pass 1: Standard ±1 day reconciliation
      firstPassReconciliation(creditTransactions, processedData, matchedDebitIds);
      
      // Track matched credits from Pass 1
      creditTransactions.forEach(tx => {
        if (tx.reconciled && tx.reconciliation_pass === 1) {
          matchedCreditIds.add(tx.unique_id);
        }
      });

      // Execute Pass 2: Extended ±5 day reconciliation for unmatched
      secondPassReconciliation(creditTransactions, processedData, matchedDebitIds);
      
      // Track matched credits from Pass 2
      creditTransactions.forEach(tx => {
        if (tx.reconciled && tx.reconciliation_pass === 2 && !matchedCreditIds.has(tx.unique_id)) {
          matchedCreditIds.add(tx.unique_id);
        }
      });

      // Execute Pass 3: Reverse matching (1 debit → multiple credits)
      thirdPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds);

      return { matchedDebitIds, processedData };
    }

    // Get matches using two-pass reconciliation
    const { matchedDebitIds, processedData } = findMatchingTransactions(fullDataset);

    // CROSS-VENDOR MATCH DETECTION: Check for possible entry errors
    const unReconciledTransactions = processedData.filter(tx => !tx.reconciled);
    
    if (unReconciledTransactions.length > 0) {
      // Get all digital vendors EXCEPT the current one (performance optimization)
      const allVendors = await CreditDao.findAll(locationCode);
      const digitalVendors = allVendors.filter(v => 
        v.card_flag === 'Y' && 
        v.creditlist_id !== parseInt(cid) // Exclude current vendor
      );
      
      // Early exit if no other vendors to check
      if (digitalVendors.length === 0) {
        console.log('No other digital vendors to check for cross-vendor matches');
      } else {
        console.log(`Checking ${digitalVendors.length} other vendor(s) for possible matches`);
        
        // Query each other vendor for possible matches
        for (const vendor of digitalVendors) {
          const vendorData = await ReportDao.getDigitalStmt(
            locationCode,
            dateFormat(queryFromDate, "yyyy-mm-dd"),
            dateFormat(queryToDate, "yyyy-mm-dd"),
            vendor.creditlist_id
          );

          // Process vendor data
          const vendorProcessed = vendorData.map(tx => ({
            Date: tx.tran_date,
            DateObj: new Date(tx.tran_date.split('-').reverse().join('-')),
            amount: parseFloat(tx.amount),
            vendorName: vendor.Company_Name,
            billNo: tx.bill_no,
            entryType: tx.entry_type
          }));

          // Check each unreconciled transaction against this vendor
          unReconciledTransactions.forEach(unreconciledTx => {
            // Skip if already found a possible match
            if (unreconciledTx.possibleMatch) return;
            
            const txDate = unreconciledTx.DateObj;
            const txAmount = unreconciledTx.DebitAmount || unreconciledTx.CreditAmount;
            const txType = unreconciledTx.DebitAmount ? 'DEBIT' : 'CREDIT';
            
            // Look for exact match (±1 day)
            const prevDate = new Date(txDate);
            prevDate.setDate(prevDate.getDate() - 1);
            const nextDate = new Date(txDate);
            nextDate.setDate(nextDate.getDate() + 1);

            const possibleMatch = vendorProcessed.find(otherTx => {
              // Check if date is within range
              const dateMatch = otherTx.DateObj >= prevDate && otherTx.DateObj <= nextDate;
              // Check if amount is exact match
              const amountMatch = Math.abs(otherTx.amount - txAmount) === 0;
              // Check if entry type matches
              const typeMatch = otherTx.entryType === txType;
              
              return dateMatch && amountMatch && typeMatch;
            });

            if (possibleMatch) {
              unreconciledTx.possibleMatch = {
                vendor: possibleMatch.vendorName,
                date: possibleMatch.Date,
                billNo: possibleMatch.billNo,
                amount: possibleMatch.amount
              };
            }
          });
        }
      }
    }

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
        match_id: transaction.match_id,
        reconciliation_pass: transaction.reconciliation_pass, // 1 = standard, 2 = extended
        possibleMatch: transaction.possibleMatch || null // Add possible match hint
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
