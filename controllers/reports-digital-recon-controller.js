const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
var ReportDao = require("../dao/report-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
var CreditDao = require("../dao/credits-dao");
const moment = require('moment');
const locationConfig = require('../utils/location-config');
const db = require("../db/db-connection");



exports.getDigitalReconReport = async (req, res) => {
    let locationCode = req.user.location_code;
    let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    let cid = req.body.company_id;

    let lookbackDays = 5; // Final fallback

    const vendorLookbackDays = await CreditDao.getVendorLookbackDays(cid, locationCode);

    if (vendorLookbackDays !== null) {
      lookbackDays = vendorLookbackDays;
      console.log(`Using vendor-specific lookback: ${lookbackDays} days`);
    } else {
      // Second: Check location config (location-specific or system default '*')
      const configLookbackDays = await locationConfig.getLocationConfigValue(
        locationCode,
        'RECON_DEFAULT_LOOKBACK_DAYS',
        '5' // default value if not configured
      );
      
      lookbackDays = parseInt(configLookbackDays);
      console.log(`Using config lookback: ${lookbackDays} days`);
    }


    // Get cross-vendor matching setting
    const enableCrossVendorMatch = await locationConfig.getLocationConfigValue(
      locationCode,
      'RECON_CROSS_VENDOR_MATCH',
      'N' // default: disabled
    );

    // Manual Match Tolerance
    const manualTolerance = await locationConfig.getLocationConfigValue(
        locationCode,
        'RECON_MANUAL_MATCH_TOLERANCE',
        '1' // default = ₹1 tolerance
    );

    let caller = req.body.caller;
    let credits = [];

    if (req.body.fromClosingDate) {
      fromDate = req.body.fromClosingDate;
    }
    if (req.body.toClosingDate) {
      toDate = req.body.toClosingDate;
    }

    // Validate date range: Maximum 65 days
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    const daysDifference = Math.ceil((toDateObj - fromDateObj) / (1000 * 60 * 60 * 24));
    
    if (daysDifference > 65) {
      // Get credits list for dropdown even on error
      const allCredits = await CreditDao.findAll(locationCode);
      allCredits.forEach((credit) => {
        if (credit.card_flag === 'Y') {
          credits.push({
            id: credit.creditlist_id,
            name: credit.Company_Name
          });
        }
      });
      
      return res.render("reports-digital-recon", {
        title: 'Digital Reconciliation',
        user: req.user,
        credits: credits,
        creditstmt: [],
        fromClosingDate: fromDate,
        toClosingDate: toDate,
        formattedFromDate: dateFormat(fromDateObj, "dd-mm-yyyy"),
        formattedToDate: dateFormat(toDateObj, "dd-mm-yyyy"),
        company_id: cid,
        OpeningBal: 0,
        closingBal: 0,
        currentDate: dateFormat(new Date(), "yyyy-mm-dd"),
        manualTolerance,
        error_message: `Date range cannot exceed 65 days. Current range: ${daysDifference} days. Please select a shorter period.`
      });
    }

    let Creditstmtlist = [];    
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
 const fullDataset = data1.map((row, index) => {
    const amount = parseFloat(row.amount);
    const isDebit = row.entry_type === "DEBIT";

    return {
        unique_id: `${index}`,

        // Existing display fields
        Date: row.tran_date,
        bill_no: row.bill_no,
        Narration: [row.bill_no, row.notes].filter(Boolean).join(" - "),
        companyName: row.company_name,
        entry_type: row.entry_type,
        Debit: isDebit ? amount : null,
        Credit: !isDebit ? amount : null,

        // New fields for DB reconciliation
        source_table: row.source_table,
        source_id: row.source_id,
        recon_match_id_db: row.recon_match_id,
        manual_recon_flag_db: row.manual_recon_flag,
        manual_recon_by_db: row.manual_recon_by,
        manual_recon_date_db: row.manual_recon_date,

        // IMPORTANT: Mark DB matches as already reconciled
        reconciled: row.recon_match_id ? true : false,
        match_id: row.recon_match_id || null,

        // Additional metadata (optional)
        reconciliation_pass: row.recon_match_id ? 0 : null
    };
});


   function findMatchingTransactions(transactions, lookbackDays) {
  const TOLERANCE = 1; // Rs 1 tolerance
 const processedData = transactions.map(tx => ({
  ...tx,
  DateObj: new Date(tx.Date.split('-').reverse().join('-')),
  DebitAmount: tx.Debit ? parseFloat(tx.Debit) : null,
  CreditAmount: tx.Credit ? parseFloat(tx.Credit) : null,  
  reconciled: tx.reconciled ? true : false,
  match_id: tx.match_id || null,
  reconciliation_pass: tx.reconciled ? 0 : null,
}));

  let matchCounter = 1;

  function getCombinations(arr, size) {
    const combinations = [];
    const helper = (start, combo) => {
      if (combo.length === size) {
        combinations.push([...combo]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    };
    helper(0, []);
    return combinations;
  }

  /*--------------------------------------------------------------
   🧩 PASS 1 – Standard Match (±1 day)
  --------------------------------------------------------------*/
  function firstPassReconciliation(creditTransactions, processedData, matchedDebitIds) {
    creditTransactions.forEach(creditTx => {
      if (creditTx.reconciled) return;

      const creditDate = creditTx.DateObj;
      const creditAmount = creditTx.CreditAmount;

      const prevDate = new Date(creditDate);
      prevDate.setDate(prevDate.getDate() - 1);

      const dateList = [prevDate.toISOString().split('T')[0], creditDate.toISOString().split('T')[0]];
      const relevantDebits = processedData.filter(tx =>
        tx.DebitAmount !== null &&
        !matchedDebitIds.has(tx.unique_id) &&
        dateList.includes(tx.DateObj.toISOString().split('T')[0])
      );

      // Single debit exact/tolerance
      for (const debit of relevantDebits) {
        const diff = Math.abs(debit.DebitAmount - creditAmount);
        if (diff <= TOLERANCE) {
          const matchId = matchCounter++;
          debit.reconciled = creditTx.reconciled = true;
          debit.match_id = creditTx.match_id = matchId;
          debit.reconciliation_pass = creditTx.reconciliation_pass = 1;
          matchedDebitIds.add(debit.unique_id);
          return;
        }
      }

      // Multi-debit combos
      for (let i = 2; i <= Math.min(relevantDebits.length, 5); i++) {
        const combos = getCombinations(relevantDebits, i);
        for (const combo of combos) {
          const sum = combo.reduce((s, d) => s + d.DebitAmount, 0);
          const diff = Math.abs(sum - creditAmount);
          if (diff <= TOLERANCE) {
            const matchId = matchCounter++;
            combo.forEach(d => {
              d.reconciled = true;
              d.match_id = matchId;
              d.reconciliation_pass = 1;
              matchedDebitIds.add(d.unique_id);
            });
            creditTx.reconciled = true;
            creditTx.match_id = matchId;
            creditTx.reconciliation_pass = 1;
            return;
          }
        }
      }
    });
  }

  /*--------------------------------------------------------------
   🧩 PASS 2 – Extended (±lookbackDays)
  --------------------------------------------------------------*/
  function secondPassReconciliation(creditTransactions, processedData, matchedDebitIds) {
    const unmatchedCredits = creditTransactions.filter(tx => !tx.reconciled);
    unmatchedCredits.forEach(creditTx => {
      const creditDate = creditTx.DateObj;
      const creditAmount = creditTx.CreditAmount;

      const fromDate = new Date(creditDate);
      fromDate.setDate(fromDate.getDate() - lookbackDays);
      const toDate = new Date(creditDate);

      const relevantDebits = processedData.filter(tx =>
        tx.DebitAmount !== null &&
        !matchedDebitIds.has(tx.unique_id) &&
        tx.DateObj >= fromDate &&
        tx.DateObj <= toDate
      );

      for (let i = 1; i <= Math.min(relevantDebits.length, 6); i++) {
        const combos = getCombinations(relevantDebits, i);
        for (const combo of combos) {
          const sum = combo.reduce((acc, d) => acc + d.DebitAmount, 0);
          const diff = Math.abs(sum - creditAmount);
          if (diff <= TOLERANCE) {
            const matchId = matchCounter++;
            combo.forEach(d => {
              d.reconciled = true;
              d.match_id = matchId;
              d.reconciliation_pass = 2;
              matchedDebitIds.add(d.unique_id);
            });
            creditTx.reconciled = true;
            creditTx.match_id = matchId;
            creditTx.reconciliation_pass = 2;
            return;
          }
        }
      }
    });
  }

  /*--------------------------------------------------------------
   🧩 PASS 3 – Reverse: 1 Debit → Many Credits
  --------------------------------------------------------------*/
  function thirdPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds) {
    const unmatchedDebits = processedData.filter(tx => tx.DebitAmount && !matchedDebitIds.has(tx.unique_id));
    unmatchedDebits.forEach(debitTx => {
      const debitDate = debitTx.DateObj;
      const debitAmount = debitTx.DebitAmount;

      const fromDate = new Date(debitDate);
      const toDate = new Date(debitDate);
      toDate.setDate(toDate.getDate() + lookbackDays);

      const relevantCredits = creditTransactions.filter(tx =>
        !matchedCreditIds.has(tx.unique_id) &&
        tx.DateObj >= fromDate &&
        tx.DateObj <= toDate
      );

      for (let i = 2; i <= Math.min(relevantCredits.length, 5); i++) {
        const combos = getCombinations(relevantCredits, i);
        for (const combo of combos) {
          const sum = combo.reduce((acc, c) => acc + c.CreditAmount, 0);
          if (Math.abs(sum - debitAmount) <= TOLERANCE) {
            const matchId = matchCounter++;
            debitTx.reconciled = true;
            debitTx.match_id = matchId;
            debitTx.reconciliation_pass = 3;
            matchedDebitIds.add(debitTx.unique_id);
            combo.forEach(c => {
              c.reconciled = true;
              c.match_id = matchId;
              c.reconciliation_pass = 3;
              matchedCreditIds.add(c.unique_id);
            });
            return;
          }
        }
      }
    });
  }

  /*--------------------------------------------------------------
   🧩 PASS 4 – Multi-Debit + Adjustments → 1 Credit
  --------------------------------------------------------------*/
  function fourthPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds) {
    const unmatchedCredits = creditTransactions.filter(tx => !tx.reconciled);
    unmatchedCredits.forEach(creditTx => {
      const creditDate = creditTx.DateObj;
      const creditAmount = creditTx.CreditAmount;

      const fromDate = new Date(creditDate);
      fromDate.setDate(fromDate.getDate() - lookbackDays);
      const toDate = new Date(creditDate);
      toDate.setDate(toDate.getDate() + lookbackDays);

      // Pick all debits + adjustments (small opposite credits)
      const relevant = processedData.filter(tx =>
        !tx.reconciled &&
        tx.DateObj >= fromDate &&
        tx.DateObj <= toDate &&
        (
          tx.DebitAmount !== null ||
          (tx.CreditAmount !== null && tx.bill_no.startsWith('ADJ-'))
        )
      );

      for (let i = 2; i <= Math.min(relevant.length, 6); i++) {
        const combos = getCombinations(relevant, i);
        for (const combo of combos) {
          const totalDebits = combo.reduce((s, t) => s + (t.DebitAmount || 0), 0);
          const totalAdjustments = combo.reduce((s, t) => s + (t.CreditAmount && t.bill_no.startsWith('ADJ-') ? t.CreditAmount : 0), 0);
          const net = totalDebits - totalAdjustments;
          if (Math.abs(net - creditAmount) <= TOLERANCE) {
            const matchId = matchCounter++;
            combo.forEach(t => {
              t.reconciled = true;
              t.match_id = matchId;
              t.reconciliation_pass = 4;
              matchedDebitIds.add(t.unique_id);
            });
            creditTx.reconciled = true;
            creditTx.match_id = matchId;
            creditTx.reconciliation_pass = 4;
            matchedCreditIds.add(creditTx.unique_id);
            return;
          }
        }
      }
    });
  }

/*--------------------------------------------------------------
 🧩 PASS 5 – Shift Offset Detector (Consecutive-Day ₹ Carryover)
--------------------------------------------------------------*/
function fifthPassShiftOffsetReconciliation(
  creditTransactions,
  processedData,
  matchedDebitIds,
  matchedCreditIds
) {
  const TOLERANCE = 1;           // exact match ±₹1
  const MAX_SHIFT_AMOUNT = 100;  // only detect ≤ ₹100 carryovers

  // Collect small unreconciled debits and credits
  const unmatchedDebits = processedData.filter(
    tx =>
      !tx.reconciled &&
      tx.DebitAmount !== null &&
      tx.DebitAmount <= MAX_SHIFT_AMOUNT
  );

  const unmatchedCredits = processedData.filter(
    tx =>
      !tx.reconciled &&
      tx.CreditAmount !== null &&
      tx.CreditAmount <= MAX_SHIFT_AMOUNT
  );

  // Compare small debits with next-day small credits
  unmatchedDebits.forEach(debitTx => {
    const debitDate = debitTx.DateObj;
    const nextDay = new Date(debitDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const possibleMatch = unmatchedCredits.find(creditTx => {
      const diffAmt = Math.abs(creditTx.CreditAmount - debitTx.DebitAmount);
      const dayDiff = Math.abs(
        (creditTx.DateObj - debitDate) / (1000 * 60 * 60 * 24)
      );
      return diffAmt <= TOLERANCE && dayDiff <= 1; // consecutive-day match
    });

    if (possibleMatch) {
      const matchId = matchCounter++;

      debitTx.reconciled = true;
      debitTx.match_id = matchId;
      debitTx.reconciliation_pass = 5; // new code for shift offset
      matchedDebitIds.add(debitTx.unique_id);

      possibleMatch.reconciled = true;
      possibleMatch.match_id = matchId;
      possibleMatch.reconciliation_pass = 5;
      matchedCreditIds.add(possibleMatch.unique_id);

      console.log(
        `Pass 5 (Shift Offset): Matched ₹${debitTx.DebitAmount} between ${debitTx.Date} and ${possibleMatch.Date}`
      );
    }
  });
}


  /*--------------------------------------------------------------
   🧩 EXECUTION SEQUENCE
  --------------------------------------------------------------*/
  const creditTransactions = processedData.filter(tx => tx.CreditAmount !== null);
  const matchedDebitIds = new Set();
  const matchedCreditIds = new Set();

  firstPassReconciliation(creditTransactions, processedData, matchedDebitIds);
  secondPassReconciliation(creditTransactions, processedData, matchedDebitIds);
  thirdPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds);
  fourthPassReconciliation(creditTransactions, processedData, matchedDebitIds, matchedCreditIds);
  fifthPassShiftOffsetReconciliation(creditTransactions,processedData,matchedDebitIds,matchedCreditIds);

  return { matchedDebitIds, processedData };
}


    // Get matches using two-pass reconciliation
    const { matchedDebitIds, processedData } = findMatchingTransactions(fullDataset, lookbackDays);

    // CROSS-VENDOR MATCH DETECTION: Check for possible entry errors
    // CROSS-VENDOR MATCH DETECTION: Check for possible entry errors (OPTIONAL - Performance intensive)
  if (enableCrossVendorMatch === 'Y') {
    console.log('Cross-vendor matching is ENABLED - checking other vendors...');

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
  }
  else
    {
      console.log('Cross-vendor matching is DISABLED (for better performance)');
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
        possibleMatch: transaction.possibleMatch || null, // Add possible match hint
        source_table: transaction.source_table,
        source_id: transaction.source_id,
        manual_recon_flag: transaction.manual_recon_flag_db || 0
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
      manualTolerance,
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



// ============================
// PRIMARY KEY MAP
// ============================
const PK_MAP = {
    t_digital_sales: "digital_sales_id",
    t_receipts: "treceipt_id",
    t_adjustments: "adjustment_id",
    t_bank_transaction: "transaction_id",
    t_cashflow_transaction: "transaction_id"
};

// Update the existing manualMatch function
exports.manualMatch = async (req, res) => {
    try {
        const { rows } = req.body;  // Changed from selectedRows to rows
        const locationCode = req.user.location_code;
        const userId = req.user.Person_id;
        const userRole = req.user.Role;

        console.log('manualMatch called with rows:', rows);

        // Determine allowed difference based on role
        const allowedDifference = (userRole === 'Admin' || userRole === 'SuperUser') ? 1000 : 100;

        if (!rows || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No rows selected' });
        }

        // Calculate totals
        let debitTotal = 0;
        let creditTotal = 0;

        rows.forEach(row => {
            const debit = parseFloat(row.Debit || 0);
            const credit = parseFloat(row.Credit || 0);
            
            if (debit > 0) {
                debitTotal += debit;
            }
            if (credit > 0) {
                creditTotal += credit;
            }
        });

        const difference = Math.abs(debitTotal - creditTotal);

        console.log('Calculated totals:', { debitTotal, creditTotal, difference });

        // Check if difference is within allowed limit
        if (difference > allowedDifference) {
            return res.json({
                success: false,
                message: `Difference of ₹${difference.toFixed(2)} exceeds allowed limit of ₹${allowedDifference.toFixed(2)}`,
                allowedDifference: allowedDifference
            });
        }

        // If there's a difference (but within limit), ask for confirmation
        if (difference > 0) {
            // Get earliest date from selected rows
            const dates = rows.map(row => {
                // Parse the date from dd-mm-yyyy format
                const dateStr = row.Date;
                const [day, month, year] = dateStr.split('-');
                return new Date(year, month - 1, day);
            });
            
            const earliestDate = new Date(Math.min(...dates));

            return res.json({
                success: false,
                requiresConfirmation: true,
                difference: difference,
                debitTotal: debitTotal,
                creditTotal: creditTotal,
                earliestDate: earliestDate.toISOString().split('T')[0],
                message: `There is a difference of ₹${difference.toFixed(2)}. Would you like to save this difference?`
            });
        }

        // If no difference, proceed with normal matching
        const matchId = Date.now();

        console.log('No difference, proceeding with matchId:', matchId);

        for (const row of rows) {
            console.log('Updating row:', row.source_table, row.source_id);
            await ReportDao.updateReconMatch({
                tableName: row.source_table,
                recordId: row.source_id,
                matchId: matchId,
                user: userId
            });
        }

        res.json({
            success: true,
            message: 'Manual match completed successfully',
            match_id: matchId  // Changed from matchId to match_id to match expected response
        });

    } catch (error) {
        console.error('Error in manual match:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message  // Changed from message to error to match frontend expectation
        });
    }
};

// NEW FUNCTION: Save difference after user confirmation
exports.saveDifferenceAndMatch = async (req, res) => {
    console.log('saveDifferenceAndMatch ENTRY');
    console.log('req.body:', req.body);
    
    try {
        const { rows, notes, earliestDate } = req.body;
        const locationCode = req.user.location_code;
        const userId = req.user.Person_id;
        const userRole = req.user.Role;

        console.log('Extracted data:', { rows, notes, earliestDate, locationCode, userId, userRole });

        const allowedDifference = (userRole === 'Admin' || userRole === 'SuperUser') ? 1000 : 100;

        if (!rows || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No rows selected' });
        }

        if (!notes || notes.trim() === '') {
            return res.status(400).json({ success: false, message: 'Notes are required for saving difference' });
        }

        let debitTotal = 0;
        let creditTotal = 0;

        rows.forEach(row => {
            const debit = parseFloat(row.Debit || 0);
            const credit = parseFloat(row.Credit || 0);
            
            if (debit > 0) {
                debitTotal += debit;
            }
            if (credit > 0) {
                creditTotal += credit;
            }
        });

        const calculatedDifference = debitTotal - creditTotal;
        
        // INVERT THE SIGN FOR STORAGE:
        // Debit > Credit (shortage) → store as negative
        // Credit > Debit (excess) → store as positive
        const differenceToStore = -calculatedDifference;

        console.log('Calculated difference:', { 
            debitTotal, 
            creditTotal, 
            calculatedDifference, 
            differenceToStore 
        });

        if (Math.abs(calculatedDifference) > allowedDifference) {
            return res.json({
                success: false,
                message: `Difference exceeds allowed limit of ₹${allowedDifference.toFixed(2)}`
            });
        }

        const matchId = Date.now();

        console.log('Inserting difference record with matchId:', matchId);

        await ReportDao.insertDigitalReconDifference({
            location_code: locationCode,
            user_id: userId,
            match_id: matchId.toString(),
            difference_amount: differenceToStore,  // Store with inverted sign
            earliest_transaction_date: earliestDate,
            notes: notes
        });

        console.log('Difference record inserted, now updating recon matches');

        for (const row of rows) {
            console.log('Updating row:', row.source_table, row.source_id);
            await ReportDao.updateReconMatch({
                tableName: row.source_table,
                recordId: row.source_id,
                matchId: matchId,
                user: userId
            });
        }

        console.log('All updates complete');

        res.json({
            success: true,
            message: 'Manual match completed and difference saved successfully',
            matchId: matchId,
            difference: Math.abs(calculatedDifference)
        });

    } catch (error) {
        console.error('Error in saveDifferenceAndMatch:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Error saving difference and performing match',
            error: error.message
        });
    }
};


exports.getDifferences = async (req, res) => {
    console.log('getDifferences ENTRY POINT');
    
    try {
        const { fromDate, toDate } = req.body;
        const locationCode = req.user.location_code;

        console.log('getDifferences called with:', { locationCode, fromDate, toDate });

        const differences = await ReportDao.getDigitalReconDifferences(
            locationCode,
            fromDate,
            toDate
        );

        console.log('Differences found:', differences ? differences.length : 0);

        res.json({
            success: true,
            differences: differences || []
        });

    } catch (error) {
        console.error('Error in getDifferences controller:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Error fetching differences',
            error: error.message
        });
    }
};