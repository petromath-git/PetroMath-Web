const db = require("../db/db-connection");
const bankDepositReconDao = require("../dao/report-bank-deposit-recon-dao");
const moment = require("moment");

module.exports = {

    /**
     * Main function to get bank deposit reconciliation report
     */
    getBankDepositReconReport: async (req, res, next) => {
        try {
            const caller = req.body.caller || 'notpdf';
            const locationCode = req.user.location_code;
            const bankId = req.body.bank_id || null;

            // Date handling
            let fromDate = req.body.fromDate || req.body.fromclosingDate_hiddenValue;
            let toDate = req.body.toDate || req.body.toclosingDate_hiddenValue;

            if (!fromDate || !toDate) {
                const today = new Date();
                const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                fromDate = moment(firstDayOfMonth).format('YYYY-MM-DD');
                toDate = moment(today).format('YYYY-MM-DD');
            }

            // Get bank accounts list
            const bankAccounts = await bankDepositReconDao.getBankAccountsList(locationCode);

            // Get cashflow deposits (debits from cash)
            const cashflowDeposits = await bankDepositReconDao.getCashflowBankDeposits(
                locationCode, 
                fromDate, 
                toDate
            );

            // Get bank transaction credits (credits to bank)
            const bankCredits = await bankDepositReconDao.getBankTransactionCredits(
                locationCode, 
                fromDate, 
                toDate, 
                bankId
            );

            // Run automatic matching algorithm
            const { matchedData, unmatchedCashflow, unmatchedBank } = performMatching(
                cashflowDeposits,
                bankCredits
            );

            // Combine all data for display
            const allTransactions = combineTransactions(
                cashflowDeposits,
                bankCredits
            );

            // Calculate summary statistics
            const summary = calculateSummary(allTransactions);

            // Format dates for display
            const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
            const formattedToDate = moment(toDate).format('DD/MM/YYYY');

            // Prepare render data
            const renderData = {
                title: 'Bank Deposit Reconciliation',
                user: req.user,
                fromDate,
                toDate,
                formattedFromDate,
                formattedToDate,
                bankAccounts,
                selectedBankId: bankId,
                transactions: allTransactions,
                summary,
                manualTolerance: 0, // Zero tolerance as per requirement
            };

            if (caller === 'notpdf') {
                res.render('reports-bank-deposit-recon', renderData);
            } else {
                return new Promise((resolve, reject) => {
                    res.render('reports-bank-deposit-recon', renderData, (err, html) => {
                        if (err) {
                            console.error('getBankDepositReconReport: Error in res.render:', err);
                            reject(err);
                        } else {
                            console.log('getBankDepositReconReport: Successfully rendered HTML');
                            resolve(html);
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Error in getBankDepositReconReport:', error);
            next(error);
        }
    },

    /**
     * Manual match endpoint
     */
    manualMatch: async (req, res) => {
        console.log("Inside manualMatch API (Bank Deposit), body = ", req.body);

        try {
            const { rows } = req.body;
            const user = req.user.User_Name || req.user.username || req.user.user_id;

            if (!rows || rows.length < 2) {
                return res.status(400).json({ error: "Select at least two rows to match." });
            }

            // Validate all rows before matching
            for (const row of rows) {
                const table = row.source_table;
                const pkField = table === 't_cashflow_transaction' ? 'transaction_id' : 't_bank_id';

                const sql = `
                    SELECT recon_match_id, manual_recon_flag 
                    FROM ${table}
                    WHERE ${pkField} = :id
                `;

                const result = await db.sequelize.query(sql, {
                    replacements: { id: row.source_id },
                    type: db.Sequelize.QueryTypes.SELECT
                });

                if (result.length > 0) {
                    const record = result[0];
                    if (record.recon_match_id && record.manual_recon_flag === 1) {
                        return res.json({
                            success: false,
                            error: "One or more selected rows are already reconciled. Please unmatch first."
                        });
                    }
                }
            }

            // Validate amounts match (zero tolerance)
            let totalCashflow = 0;
            let totalBank = 0;

            for (const row of rows) {
                const amount = parseFloat(row.amount || 0);
                if (row.source_table === 't_cashflow_transaction') {
                    totalCashflow += amount;
                } else if (row.source_table === 't_bank_transaction') {
                    totalBank += amount;
                }
            }

            const diff = Math.abs(totalCashflow - totalBank);
            if (diff > 0) {
                return res.json({
                    success: false,
                    error: `Amount mismatch: Cashflow deposits = ₹${totalCashflow.toFixed(2)}, ` +
                           `Bank credits = ₹${totalBank.toFixed(2)}. Difference = ₹${diff.toFixed(2)}. ` +
                           `Exact match required (zero tolerance).`
                });
            }

            // Generate new match ID
            const matchIdResult = await db.sequelize.query(
                `SELECT COALESCE(MAX(recon_match_id), 0) + 1 as new_match_id 
                 FROM t_cashflow_transaction 
                 WHERE recon_match_id IS NOT NULL`,
                { type: db.Sequelize.QueryTypes.SELECT }
            );
            const newMatchId = matchIdResult[0].new_match_id;

            // Update all rows with the match ID
            for (const row of rows) {
                if (row.source_table === 't_cashflow_transaction') {
                    await bankDepositReconDao.updateCashflowReconMatch({
                        recordId: row.source_id,
                        matchId: newMatchId,
                        user
                    });
                } else if (row.source_table === 't_bank_transaction') {
                    await bankDepositReconDao.updateBankTxnReconMatch({
                        recordId: row.source_id,
                        matchId: newMatchId,
                        user
                    });
                }
            }

            return res.json({
                success: true,
                message: `Successfully matched ${rows.length} transactions with Match ID: ${newMatchId}`
            });

        } catch (error) {
            console.error('Error in manualMatch:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error during manual matching'
            });
        }
    },

    /**
     * Unmatch endpoint
     */
    unmatch: async (req, res) => {
        console.log("Inside unmatch API (Bank Deposit), body = ", req.body);

        try {
            const { matchId } = req.body;
            const user = req.user.User_Name || req.user.username || req.user.user_id;

            if (!matchId) {
                return res.status(400).json({ error: "Match ID is required" });
            }

            // Clear match from both tables
            await db.sequelize.query(
                `UPDATE t_cashflow_transaction 
                 SET recon_match_id = NULL, manual_recon_flag = 0, 
                     manual_recon_by = NULL, manual_recon_date = NULL
                 WHERE recon_match_id = :matchId`,
                { replacements: { matchId }, type: db.Sequelize.QueryTypes.UPDATE }
            );

            await db.sequelize.query(
                `UPDATE t_bank_transaction 
                 SET recon_match_id = NULL, manual_recon_flag = 0, 
                     manual_recon_by = NULL, manual_recon_date = NULL
                 WHERE recon_match_id = :matchId`,
                { replacements: { matchId }, type: db.Sequelize.QueryTypes.UPDATE }
            );

            return res.json({
                success: true,
                message: `Successfully unmatched Match ID: ${matchId}`
            });

        } catch (error) {
            console.error('Error in unmatch:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error during unmatching'
            });
        }
    }
};

/**
 * Automatic matching algorithm
 * Matches cashflow deposits with bank credits using ±1 day window and zero tolerance
 */
function performMatching(cashflowDeposits, bankCredits) {
    const TOLERANCE = 0; // Zero tolerance as per requirement
    let matchCounter = 1000; // Start from 1000 to avoid conflicts

    // Get next available match ID
    const existingMatchIds = [
        ...cashflowDeposits.filter(d => d.recon_match_id).map(d => d.recon_match_id),
        ...bankCredits.filter(c => c.recon_match_id).map(c => c.recon_match_id)
    ];
    if (existingMatchIds.length > 0) {
        matchCounter = Math.max(...existingMatchIds) + 1;
    }

    // Process each cashflow deposit
    const matchedDebitIds = new Set();

    cashflowDeposits.forEach(cashflowTx => {
        // Skip if already reconciled
        if (cashflowTx.recon_match_id) return;

        const cashflowDate = new Date(cashflowTx.DateObj);
        const cashflowAmount = parseFloat(cashflowTx.Amount);

        // Create ±1 day date range
        const prevDate = new Date(cashflowDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const nextDate = new Date(cashflowDate);
        nextDate.setDate(nextDate.getDate() + 1);

        const dateList = [
            prevDate.toISOString().split('T')[0],
            cashflowDate.toISOString().split('T')[0],
            nextDate.toISOString().split('T')[0]
        ];

        // Find relevant bank credits within date range
        const relevantBankCredits = bankCredits.filter(tx => {
            const txDate = new Date(tx.DateObj).toISOString().split('T')[0];
            return !matchedDebitIds.has(tx.source_id) && 
                   dateList.includes(txDate) &&
                   !tx.recon_match_id;
        });

        // Try to find exact match
        for (const bankTx of relevantBankCredits) {
            const diff = Math.abs(parseFloat(bankTx.Amount) - cashflowAmount);
            if (diff <= TOLERANCE) {
                const matchId = matchCounter++;
                cashflowTx.recon_match_id = matchId;
                cashflowTx.match_id = matchId;
                cashflowTx.reconciled = true;
                cashflowTx.reconciliation_pass = 1;

                bankTx.recon_match_id = matchId;
                bankTx.match_id = matchId;
                bankTx.reconciled = true;
                bankTx.reconciliation_pass = 1;

                matchedDebitIds.add(bankTx.source_id);
                return; // Move to next cashflow deposit
            }
        }
    });

    // Separate matched and unmatched
    const unmatchedCashflow = cashflowDeposits.filter(tx => !tx.reconciled);
    const unmatchedBank = bankCredits.filter(tx => !tx.reconciled);

    return {
        matchedData: {
            cashflow: cashflowDeposits.filter(tx => tx.reconciled),
            bank: bankCredits.filter(tx => tx.reconciled)
        },
        unmatchedCashflow,
        unmatchedBank
    };
}

/**
 * Combine cashflow and bank transactions for display
 */
function combineTransactions(cashflowDeposits, bankCredits) {
    const combined = [];

    // Add cashflow deposits
    cashflowDeposits.forEach(tx => {
        combined.push({
            Date: tx.Date,
            DateObj: tx.DateObj,
            Type: 'Cashflow Deposit',
            BankAccount: tx.BankAccount,
            Description: tx.Description,
            CashflowAmount: tx.Amount,
            BankAmount: null,
            reconciled: tx.recon_match_id ? true : false,
            match_id: tx.recon_match_id,
            reconciliation_pass: tx.reconciliation_pass || null,
            source_table: tx.source_table,
            source_id: tx.source_id,
            manual_recon_flag: tx.manual_recon_flag || 0
        });
    });

    // Add bank credits
    bankCredits.forEach(tx => {
        combined.push({
            Date: tx.Date,
            DateObj: tx.DateObj,
            Type: 'Bank Credit',
            BankAccount: tx.BankAccount,
            Description: tx.Description,
            CashflowAmount: null,
            BankAmount: tx.Amount,
            reconciled: tx.recon_match_id ? true : false,
            match_id: tx.recon_match_id,
            reconciliation_pass: tx.reconciliation_pass || null,
            source_table: tx.source_table,
            source_id: tx.source_id,
            manual_recon_flag: tx.manual_recon_flag || 0
        });
    });

    // Sort by date
    combined.sort((a, b) => new Date(a.DateObj) - new Date(b.DateObj));

    return combined;
}

/**
 * Calculate summary statistics
 */
function calculateSummary(transactions) {
    let totalCashflow = 0;
    let totalBank = 0;
    let matchedCashflow = 0;
    let matchedBank = 0;

    transactions.forEach(tx => {
        if (tx.CashflowAmount) {
            totalCashflow += parseFloat(tx.CashflowAmount);
            if (tx.reconciled) matchedCashflow += parseFloat(tx.CashflowAmount);
        }
        if (tx.BankAmount) {
            totalBank += parseFloat(tx.BankAmount);
            if (tx.reconciled) matchedBank += parseFloat(tx.BankAmount);
        }
    });

    return {
        totalCashflow,
        totalBank,
        matchedCashflow,
        matchedBank,
        unmatchedCashflow: totalCashflow - matchedCashflow,
        unmatchedBank: totalBank - matchedBank,
        difference: totalCashflow - totalBank
    };
}