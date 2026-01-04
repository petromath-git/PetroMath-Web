const bankReconDao = require("../dao/bank-reconciliation-dao");
const moment = require('moment');
const dateFormat = require('dateformat');

module.exports = {
    /**
     * GET - Initial page load with banks list
     */
    getBankReconPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            
            // Get internal banks for this location
            const banks = await bankReconDao.getInternalBanks(locationCode);

            res.render('reports-bank-recon', {
                title: 'Bank Reconciliation Report',
                user: req.user,
                banks: banks
            });

        } catch (error) {
            console.error('Error in getBankReconPage:', error);
            res.status(500).render('error', {
                message: 'Error loading bank reconciliation page',
                error: error
            });
        }
    },

    /**
     * POST - Get reconciliation report data
     */
    getBankReconReport: async (req, res) => {
        console.log('=== Bank Recon POST Request ===');
        console.log('User:', req.user);
        console.log('Body:', req.body);
        console.log('Session:', req.session);
        
        try {
            const locationCode = req.user.location_code;
            const caller = req.body.caller;
            
            // Date handling
            const fromClosingDate = new Date(req.body.fromClosingDate);
            const toClosingDate = new Date(req.body.toClosingDate);
            const fromDate = fromClosingDate.toISOString().slice(0, 10);
            const toDate = toClosingDate.toISOString().slice(0, 10);
            
            // Bank ID
            const bankId = parseInt(req.body.bank_id);
            
            // Get banks list
            const banks = await bankReconDao.getInternalBanks(locationCode);
            
            // Get selected bank details
            const selectedBank = banks.find(b => b.bank_id === bankId);
            
            // Get system and bank transactions separately
            const systemTransactions = await bankReconDao.getSystemTransactions(
                locationCode, fromDate, toDate, bankId
            );
            
            const bankTransactions = await bankReconDao.getBankTransactions(
                locationCode, fromDate, toDate, bankId
            );
            
            // Convert string amounts to numbers
            systemTransactions.forEach(txn => {
                txn.credit_amount = parseFloat(txn.credit_amount) || 0;
                txn.debit_amount = parseFloat(txn.debit_amount) || 0;
            });
            
            bankTransactions.forEach(txn => {
                txn.credit_amount = parseFloat(txn.credit_amount) || 0;
                txn.debit_amount = parseFloat(txn.debit_amount) || 0;
                txn.balance_amount = parseFloat(txn.balance_amount) || 0;
            });
            
            // Mark unmatched transactions (simple approach: check if amount exists on other side)
            systemTransactions.forEach(sysTxn => {
                const sysAmount = sysTxn.credit_amount > 0 ? sysTxn.credit_amount : sysTxn.debit_amount;
                const sysType = sysTxn.credit_amount > 0 ? 'credit' : 'debit';
                
                // Check if this exact amount exists in bank on same date
                const matchExists = bankTransactions.some(bankTxn => {
                    const bankAmount = sysType === 'credit' ? bankTxn.credit_amount : bankTxn.debit_amount;
                    const dateMatch = sysTxn.trans_date === bankTxn.txn_date;
                    const amountMatch = Math.abs(sysAmount - bankAmount) < 0.01;
                    return amountMatch && dateMatch;
                });
                
                sysTxn.isUnmatched = !matchExists;
                
                // Debug logging
                if (sysTxn.isUnmatched) {
                    console.log(`System UNMATCHED: ${sysTxn.trans_date} - ${sysTxn.remarks} - ${sysAmount}`);
                }
            });
            
            bankTransactions.forEach(bankTxn => {
                const bankAmount = bankTxn.credit_amount > 0 ? bankTxn.credit_amount : bankTxn.debit_amount;
                const bankType = bankTxn.credit_amount > 0 ? 'credit' : 'debit';
                
                // Check if this exact amount exists in system on same date
                const matchExists = systemTransactions.some(sysTxn => {
                    const sysAmount = bankType === 'credit' ? sysTxn.credit_amount : sysTxn.debit_amount;
                    const dateMatch = bankTxn.txn_date === sysTxn.trans_date;
                    const amountMatch = Math.abs(bankAmount - sysAmount) < 0.01;
                    return amountMatch && dateMatch;
                });
                
                bankTxn.isUnmatched = !matchExists;
                
                // Debug logging
                if (bankTxn.isUnmatched) {
                    console.log(`Bank UNMATCHED: ${bankTxn.txn_date} - ${bankTxn.description} - ${bankAmount}`);
                }
            });
            
            // Get summary totals
            const summaryTotals = await bankReconDao.getSummaryTotals(
                locationCode, fromDate, toDate, bankId
            );
            
            // Convert string values to numbers
            if (summaryTotals) {
                summaryTotals.system_credit = parseFloat(summaryTotals.system_credit) || 0;
                summaryTotals.system_debit = parseFloat(summaryTotals.system_debit) || 0;
                summaryTotals.bank_credit = parseFloat(summaryTotals.bank_credit) || 0;
                summaryTotals.bank_debit = parseFloat(summaryTotals.bank_debit) || 0;
            }

            // Format dates for display
            const formattedFromDate = dateFormat(fromClosingDate, 'dd-mm-yyyy');
            const formattedToDate = dateFormat(toClosingDate, 'dd-mm-yyyy');

            // Render data
            res.render('reports-bank-recon', {
                title: 'Bank Reconciliation Report',
                user: req.user,
                banks: banks,
                selectedBank: selectedBank,
                systemTransactions: systemTransactions,
                bankTransactions: bankTransactions,
                summaryTotals: summaryTotals,
                fromClosingDate: req.body.fromClosingDate,
                toClosingDate: req.body.toClosingDate,
                formattedFromDate: formattedFromDate,
                formattedToDate: formattedToDate,
                bank_id: bankId
            });

        } catch (error) {
            console.error('Error in getBankReconReport:', error);
            res.status(500).render('error', {
                message: 'Error loading bank reconciliation report',
                error: error
            });
        }
    }
};