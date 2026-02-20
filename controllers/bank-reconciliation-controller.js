const bankReconDao = require("../dao/bank-reconciliation-dao");
const moment = require('moment');
const locationConfigDao = require('../dao/location-config-dao');
const dateFormat = require('dateformat');

module.exports = {
    /**
     * GET - Initial page load with banks list
     */
    getBankReconPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            
            // Get internal banks for this location
            const banks = await bankReconDao.getBanksForReconciliation(locationCode);

            // Get last statement date for each bank
            const banksWithLastUpload = await Promise.all(
                    banks.map(async (bank) => {
                        const lastDate = await bankReconDao.getLastStatementDate(locationCode, bank.bank_id);
                        return {
                            ...bank,
                            last_upload_date: lastDate
                        };
                    })
            );

            
            



            
            res.render('reports-bank-recon', {
                title: 'Bank Reconciliation Report',
                user: req.user,
                banks: banksWithLastUpload
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
            const banks = await bankReconDao.getBanksForReconciliation(locationCode);
            
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
            
            // Helper function to calculate date difference in days
            const getDateDifference = (date1Str, date2Str) => {
                // Both dates are in 'dd-mm-yyyy' format
                const parseDate = (dateStr) => {
                    const [day, month, year] = dateStr.split('-');
                    return new Date(year, month - 1, day);
                };
                
                const d1 = parseDate(date1Str);
                const d2 = parseDate(date2Str);
                const diffTime = Math.abs(d2 - d1);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays;
            };
            
            // Track which bank transactions have been matched (prevent reuse)
            const matchedBankIds = new Set();
            
            // PHASE 1: Match system transactions to bank (1-to-1 unique matching)
            systemTransactions.forEach(sysTxn => {
                const sysAmount = sysTxn.credit_amount > 0 ? sysTxn.credit_amount : sysTxn.debit_amount;
                const sysType = sysTxn.credit_amount > 0 ? 'credit' : 'debit';
                
                // First try exact date match
                let matchInfo = bankTransactions.find(bankTxn => {
                    // Skip if this bank transaction is already matched
                    if (matchedBankIds.has(bankTxn.actual_stmt_id)) return false;
                    
                    const bankAmount = sysType === 'credit' ? bankTxn.credit_amount : bankTxn.debit_amount;
                    const dateMatch = sysTxn.trans_date === bankTxn.txn_date;
                    const amountMatch = Math.abs(sysAmount - bankAmount) < 0.01;
                    return amountMatch && dateMatch;
                });
                
                // If no exact match, try ±1 day tolerance
                if (!matchInfo) {
                    matchInfo = bankTransactions.find(bankTxn => {
                        // Skip if this bank transaction is already matched
                        if (matchedBankIds.has(bankTxn.actual_stmt_id)) return false;
                        
                        const bankAmount = sysType === 'credit' ? bankTxn.credit_amount : bankTxn.debit_amount;
                        const amountMatch = Math.abs(sysAmount - bankAmount) < 0.01;
                        
                        if (!amountMatch) return false;
                        
                        // Check if dates are within ±1 day
                        const dateDiff = getDateDifference(sysTxn.trans_date, bankTxn.txn_date);
                        return dateDiff <= 1;
                    });
                    
                    if (matchInfo) {
                        // Mark as near match
                        sysTxn.dateOffBy = getDateDifference(sysTxn.trans_date, matchInfo.txn_date);
                        sysTxn.isNearMatch = true;
                        sysTxn.bankDate = matchInfo.txn_date;
                    }
                }
                
                if (matchInfo) {
                    // Mark this bank transaction as matched (prevent reuse)
                    matchedBankIds.add(matchInfo.actual_stmt_id);
                    sysTxn.isUnmatched = false;
                    sysTxn.matchedBankId = matchInfo.actual_stmt_id;
                    
                    // Debug logging
                    if (sysTxn.isNearMatch) {
                        console.log(`System NEAR MATCH (${sysTxn.dateOffBy} day off, Bank: ${sysTxn.bankDate}): ${sysTxn.trans_date} - ${sysTxn.remarks} - ${sysAmount}`);
                    }
                } else {
                    sysTxn.isUnmatched = true;
                    console.log(`System UNMATCHED: ${sysTxn.trans_date} - ${sysTxn.remarks} - ${sysAmount}`);
                }
            });
            
            // PHASE 2: Mark unmatched bank transactions
            bankTransactions.forEach(bankTxn => {
                // If this bank transaction was matched in Phase 1, mark it as matched
                if (matchedBankIds.has(bankTxn.actual_stmt_id)) {
                    bankTxn.isUnmatched = false;
                } else {
                    bankTxn.isUnmatched = true;
                    const bankAmount = bankTxn.credit_amount > 0 ? bankTxn.credit_amount : bankTxn.debit_amount;
                    console.log(`Bank UNMATCHED: ${bankTxn.txn_date} - ${bankTxn.description} - ${bankAmount}`);
                }
            });
            
            // Matching summary
            console.log(`=== Matching Summary ===`);
            console.log(`Total System: ${systemTransactions.length}, Matched: ${systemTransactions.filter(t => !t.isUnmatched).length}, Unmatched: ${systemTransactions.filter(t => t.isUnmatched).length}`);
            console.log(`Total Bank: ${bankTransactions.length}, Matched: ${bankTransactions.filter(t => !t.isUnmatched).length}, Unmatched: ${bankTransactions.filter(t => t.isUnmatched).length}`);
            
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
    },

    /**
 * POST - Bulk add multiple entries to PetroMath from bank statement
 */
bulkAddEntries: async (req, res) => {
    try {
        const locationCode = req.user.location_code;
        const userName = req.user.User_Name || req.user.username || req.user.user_id;
        const { entries } = req.body;
        
        if (!entries || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No entries provided'
            });
        }
        
        // Validate all entries
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            
            if (!entry.trans_date || !entry.bank_id || !entry.ledger_name) {
                return res.status(400).json({
                    success: false,
                    error: `Entry ${i + 1}: Missing required fields`
                });
            }
            
            const credit = parseFloat(entry.credit_amount) || 0;
            const debit = parseFloat(entry.debit_amount) || 0;
            
            if (credit === 0 && debit === 0) {
                return res.status(400).json({
                    success: false,
                    error: `Entry ${i + 1}: Must have either credit or debit amount`
                });
            }
            
            if (credit > 0 && debit > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Entry ${i + 1}: Cannot have both credit and debit amounts`
                });
            }
        }
        
        const BankStatementDao = require('../dao/bank-statement-dao');
        let successCount = 0;
        let failedEntries = [];
        
        // Process each entry
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            
            try {
                const credit = parseFloat(entry.credit_amount) || 0;
                const debit = parseFloat(entry.debit_amount) || 0;
                
                const transactionData = {
                    trans_date: entry.trans_date,
                    bank_id: parseInt(entry.bank_id),
                    ledger_name: entry.ledger_name,
                    transaction_type: null,
                    accounting_type: null,
                    credit_amount: credit > 0 ? credit : null,
                    debit_amount: debit > 0 ? debit : null,
                    remarks: entry.remarks || '',
                    external_id: null,
                    external_source: entry.external_source || 'bulk_add',
                    running_balance: entry.running_balance ? parseFloat(entry.running_balance) : null,
                    created_by: userName
                };
                
                // Save transaction
                await BankStatementDao.saveTransaction(transactionData);
                
                // Learn from this entry
                try {
                    const entryType = credit > 0 ? 'CREDIT' : 'DEBIT';
                    await bankReconDao.learnFromSuggestion(
                        parseInt(entry.bank_id),
                        entry.remarks || '',
                        entry.ledger_name,
                        entryType
                    );
                } catch (learningError) {
                    console.error('Learning error (non-critical):', learningError);
                }
                
                successCount++;
            } catch (error) {
                console.error(`Error saving entry ${i + 1}:`, error);
                failedEntries.push({
                    index: i + 1,
                    entry: entry,
                    error: error.message
                });
            }
        }
        
        if (failedEntries.length > 0) {
            return res.json({
                success: true,
                count: successCount,
                failed: failedEntries.length,
                failedEntries: failedEntries,
                message: `${successCount} entries saved successfully, ${failedEntries.length} failed`
            });
        }
        
        res.json({
            success: true,
            count: successCount,
            message: `${successCount} entries added successfully`
        });
        
    } catch (error) {
        console.error('Error in bulkAddEntries:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},


    /**
     * GET - Impact analysis for transaction deletion
     */
    getImpactAnalysis: async (req, res) => {
        try {
            const txnId = parseInt(req.params.txnId);

            const impact = await bankReconDao.getTransactionImpact(txnId);

            if (!impact) {
                return res.status(404).json({
                    success: false,
                    error: 'Transaction not found'
                });
            }

            res.json({
                success: true,
                impact: impact
            });

        } catch (error) {
            console.error('Error in getImpactAnalysis:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    /**
     * DELETE - Delete transaction with cascade
     */
    deleteTransaction: async (req, res) => {
        try {
            const txnId = parseInt(req.params.txnId);
            const userName = req.user.User_Name || req.user.username || req.user.user_id;

            await bankReconDao.deleteTransaction(txnId, userName);

            res.json({
                success: true,
                message: 'Transaction deleted successfully'
            });

        } catch (error) {
            console.error('Error in deleteTransaction:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

   

    /**
     * POST - Add new entry to PetroMath from bank statement
     */
    addEntryToPetromath: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const userName = req.user.User_Name || req.user.username || req.user.user_id;
            
            const {
                trans_date,
                bank_id,
                ledger_name,
                credit_amount,
                debit_amount,
                remarks,
                external_id,
                external_source,
                running_balance
            } = req.body;
            
            // Validation
            if (!trans_date || !bank_id || !ledger_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields'
                });
            }
            
            const credit = parseFloat(credit_amount) || 0;
            const debit = parseFloat(debit_amount) || 0;
            
            if (credit === 0 && debit === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Transaction must have either credit or debit amount'
                });
            }
            
            if (credit > 0 && debit > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Transaction cannot have both credit and debit amounts'
                });
            }
            
            // Prepare transaction data
            const transactionData = {
                trans_date: trans_date,
                bank_id: parseInt(bank_id),
                ledger_name: ledger_name,
                transaction_type: null,
                accounting_type: null,
                credit_amount: credit > 0 ? credit : null,
                debit_amount: debit > 0 ? debit : null,
                remarks: remarks || '',
                external_id: external_id || null,
                external_source: external_source || null,
                running_balance: running_balance ? parseFloat(running_balance) : null,
                created_by: userName
            };
            
            // Save using the existing DAO method
            const BankStatementDao = require('../dao/bank-statement-dao');
            await BankStatementDao.saveTransaction(transactionData);
            
            // ========== LEARNING STEP ==========
            // Teach the system this pattern for next time
            try {
                const entryType = credit > 0 ? 'CREDIT' : 'DEBIT';
                await bankReconDao.learnFromSuggestion(
                    parseInt(bank_id),
                    remarks || '',
                    ledger_name,
                    entryType
                );
            } catch (learningError) {
                // Don't fail the save if learning fails
                console.error('Learning error (non-critical):', learningError);
            }
            // ===================================
            
            res.json({
                success: true,
                message: 'Entry added successfully'
            });
            
        } catch (error) {
            console.error('Error in addEntryToPetromath:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    /**
     * GET - Get allowed ledgers with suggestion for add entry modal
     */
    getLedgersWithSuggestion: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const bankId = parseInt(req.query.bank_id);
            const description = req.query.description || '';
            const entryType = req.query.entry_type || 'BOTH'; // CREDIT, DEBIT, or BOTH
            
            if (!bankId) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Bank ID is required' 
                });
            }
            
            // Get all allowed ledgers
            const BankStatementDao = require('../dao/bank-statement-dao');
            const allLedgers = await BankStatementDao.getAllowedLedgers(bankId, locationCode);
            
            // Filter ledgers by entry type
            const filteredLedgers = allLedgers.filter(ledger => {
                if (entryType === 'BOTH') return true;
                return ledger.allowed_entry_type === 'BOTH' || ledger.allowed_entry_type === entryType;
            });
            
            // Get suggested ledger based on description
            let suggestedLedgerName = null;
            if (description) {
                const suggestion = await bankReconDao.getSuggestedLedger(bankId, description, entryType);
                if (suggestion) {
                    // Verify the suggested ledger is in the filtered list
                    const isAllowed = filteredLedgers.some(l => l.ledger_name === suggestion.ledger_name);
                    if (isAllowed) {
                        suggestedLedgerName = suggestion.ledger_name;
                    }
                }
            }
            
            res.json({
                success: true,
                ledgers: filteredLedgers,
                suggestedLedger: suggestedLedgerName
            });
            
        } catch (error) {
            console.error('Error in getLedgersWithSuggestion:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    /**
 * POST - Upload and preview bank statement
 * UPDATED: Excludes today's transactions, disables duplicate checkboxes
 */
uploadBankStatement: async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const locationCode = req.user.location_code;
        const bankId = parseInt(req.body.bank_id);
        const userName = req.user.User_Name || req.user.username || req.user.user_id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        // Get bank template
        const template = await bankReconDao.getBankTemplate(bankId);
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'No template found for this bank. Please configure template first.'
            });
        }

        // Parse Excel file
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        // ========== STEP 1: Parse all dates first to find earliest date ==========
        const tempDates = [];
        for (let i = template.data_start_row - 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;
            
            const txnDate = parseExcelDate(
                    row[columnToIndex(template.value_date_column || template.date_column)],
                    template.date_format  // ← Pass the format from template
                );
            if (txnDate) {
                tempDates.push(txnDate);
            }
        }
        
        if (tempDates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid transactions found in uploaded file'
            });
        }
        
        const earliestUploadDate = tempDates.sort()[0];
        const latestUploadDate = tempDates[tempDates.length - 1];

        // ========== STEP 2: Overlap Validation ==========
        
        const overlapMode = await locationConfigDao.getSetting(
            locationCode, 
            'bank_statement_overlap_mode'
        ) || 'off';
        
        const overlapDays = parseInt(
            await locationConfigDao.getSetting(
                locationCode, 
                'bank_statement_overlap_days'
            ) || '1'
        );
        
        const lastUploadedDate = await bankReconDao.getLastStatementDate(locationCode, bankId);
        
        if (lastUploadedDate && overlapMode !== 'off') {
            const lastDate = new Date(lastUploadedDate);
            const uploadDate = new Date(earliestUploadDate);
            
            const expectedOverlapDate = new Date(lastDate);
            expectedOverlapDate.setDate(lastDate.getDate() - (overlapDays - 1));
            
            const hasOverlap = uploadDate <= lastDate;
            const meetsOverlapRequirement = uploadDate <= expectedOverlapDate;
            
         
            
            if (!meetsOverlapRequirement) {
                const gapDays = Math.ceil((uploadDate - lastDate) / (1000 * 60 * 60 * 24));
                
                const message = `Gap detected! Your last upload ended on ${formatDateForDisplay(lastUploadedDate)}. ` +
                    `This upload starts on ${formatDateForDisplay(earliestUploadDate)} (${gapDays} day gap). ` +
                    `To prevent missing transactions, uploads must overlap by at least ${overlapDays} day(s). ` +
                    `Please upload a statement that includes ${formatDateForDisplay(expectedOverlapDate.toISOString().split('T')[0])} or earlier.`;
                
                if (overlapMode === 'strict') {
                    return res.status(400).json({
                        success: false,
                        error: message,
                        errorType: 'OVERLAP_REQUIRED',
                        details: {
                            lastUploadedDate: formatDateForDisplay(lastUploadedDate),
                            earliestUploadDate: formatDateForDisplay(earliestUploadDate),
                            gapDays: gapDays,
                            requiredOverlapDays: overlapDays,
                            suggestedStartDate: formatDateForDisplay(expectedOverlapDate.toISOString().split('T')[0])
                        }
                    });
                } else if (overlapMode === 'warning') {
                    console.warn('OVERLAP WARNING:', message);
                }
            }
        }

        // ========== STEP 3: Exclude today's transactions (if configured) ==========
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        const excludeTodaySetting = await locationConfigDao.getSetting(
            locationCode, 
            'bank_statement_exclude_today'
        );
        const excludeToday = excludeTodaySetting === 'true';

        // ========== STEP 4: Parse transactions ==========
        
        const transactions = [];
        const excludedTodayCount = [];
        
        for (let i = template.data_start_row - 1; i < data.length; i++) {
            const row = data[i];
            
            if (!row || row.length === 0) continue;

            const txnDate = parseExcelDate(
                    row[columnToIndex(template.value_date_column || template.date_column)],
                    template.date_format  // ← Pass the format from template
                );
            
            if (excludeToday && txnDate >= todayStr) {
                excludedTodayCount.push(txnDate);
                continue;
            }

            const debitRaw = row[columnToIndex(template.debit_column)] || '';
            const creditRaw = row[columnToIndex(template.credit_column)] || '';
            const balanceRaw = row[columnToIndex(template.balance_column)] || '';

            const debitAmount = parseFloat(String(debitRaw).replace(/,/g, '')) || 0;
            const creditAmount = parseFloat(String(creditRaw).replace(/,/g, '')) || 0;

              // ===== SKIP TOTAL/SUMMARY ROWS =====
            // Rows with BOTH debit and credit are typically total/summary rows
            if (debitAmount > 0 && creditAmount > 0) {
                console.log(`Skipping summary/total row at index ${i}: Debit=${debitAmount}, Credit=${creditAmount}`);
                continue;
            }

            // Skip rows with no amounts
            if (debitAmount === 0 && creditAmount === 0) continue;

            const txn = {
                txn_date: txnDate,
                description: row[columnToIndex(template.description_column)] || '',
                debit_amount: debitAmount,
                credit_amount: creditAmount,
                balance_amount: parseFloat(String(balanceRaw).replace(/,/g, '')) || 0,
                running_balance: parseFloat(String(balanceRaw).replace(/,/g, '')) || null, 
                statement_ref: row[columnToIndex(template.reference_column)] || null,
                source_file: req.file.originalname
            };

            if (txn.debit_amount === 0 && txn.credit_amount === 0) continue;

            transactions.push(txn);
        }

        // ========== STEP 5: Account Validation ==========



const accountValidation = await validateStatementAccountMatch(
    bankId,
    locationCode,        // ← pass locationCode (needed for t_bank_statement_actual)
    transactions,
    lastUploadedDate    // ← use statement date, not transaction date
);

if (!accountValidation.isValid) {
    return res.status(400).json({
        success: false,
        error: accountValidation.message || 'Account validation failed',
        errorType: 'ACCOUNT_MISMATCH',
        details: {
            overlapDate: formatDateForDisplay(accountValidation.overlapDate),
            overlapTransactions: accountValidation.overlapCount,
            matchesFound: 0,
            suggestion: 'Please verify you have selected the correct bank account'
        }
    });
}

if (accountValidation.warning) {
    console.warn('ACCOUNT VALIDATION WARNING:', accountValidation.warning);
}

        // ========== STEP 6: Check for duplicates ==========

     
        
        const duplicates = await bankReconDao.checkDuplicates(locationCode, bankId, transactions);
        
     
        const transactionsWithDupFlag = transactions.map(txn => {
            const isDup = duplicates.some(dup => 
                dup.txn_date === txn.txn_date && 
                dup.description === txn.description &&
                parseFloat(dup.credit_amount) === parseFloat(txn.credit_amount) &&
                parseFloat(dup.debit_amount) === parseFloat(txn.debit_amount)
            );
            return {
                ...txn,
                is_duplicate: isDup
            };
        });

        // ========== STEP 7: Return response ==========
        
        res.json({
            success: true,
            transactions: transactionsWithDupFlag,
            duplicates: duplicates,
            summary: {
                total: transactions.length,
                duplicates: duplicates.length,
                excluded_today: excludedTodayCount.length,
                last_uploaded_date: lastUploadedDate,
                earliest_upload_date: earliestUploadDate,
                latest_upload_date: latestUploadDate,
                overlap_mode: overlapMode,
                has_gap: lastUploadedDate && earliestUploadDate > lastUploadedDate
            }
        });

    } catch (error) {
        console.error('Error in uploadBankStatement:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},



/**
 * POST - Save uploaded bank statement transactions
 * UPDATED: Records upload history
 */
saveBankStatement: async (req, res) => {

    

    try {
        const locationCode = req.user.location_code;
        const bankId = parseInt(req.body.bank_id);
        const transactions = req.body.transactions;
        const userName = req.user.User_Name || req.user.username || req.user.user_id;
        const sourceFile = transactions[0]?.source_file || 'Unknown';

        if (!transactions || transactions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No transactions to save'
            });
        }

        // Filter out duplicates (only save non-duplicates)
        const nonDuplicates = transactions.filter(t => !t.is_duplicate);

        if (nonDuplicates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'All transactions are duplicates. Nothing to import.'
            });
        }

        // Calculate date range
        const dates = nonDuplicates.map(t => t.txn_date).sort();
        const firstTxnDate = dates[0];
        const lastTxnDate = dates[dates.length - 1];

        // Insert transactions
        const result = await bankReconDao.bulkInsertStatements(
            locationCode, bankId, nonDuplicates, userName
        );

        // Record upload history
        await bankReconDao.insertUploadHistory({
            location_code: locationCode,
            bank_id: bankId,
            source_file: sourceFile,
            uploaded_by: userName,
            total_transactions: transactions.length,
            duplicates_found: transactions.length - nonDuplicates.length,
            transactions_imported: result.inserted,
            first_txn_date: firstTxnDate,
            last_txn_date: lastTxnDate,
            status: 'COMPLETED',
            remarks: `Imported ${result.inserted} transactions from ${firstTxnDate} to ${lastTxnDate}`
        });

        res.json({
            success: true,
            message: `${result.inserted} transactions imported successfully (${transactions.length - nonDuplicates.length} duplicates skipped)`
        });

    } catch (error) {
        console.error('Error in saveBankStatement:', error);
        
        // Record failed upload
        try {
            await bankReconDao.insertUploadHistory({
                location_code: req.user.location_code,
                bank_id: parseInt(req.body.bank_id),
                source_file: req.body.transactions[0]?.source_file || 'Unknown',
                uploaded_by: req.user.User_Name || req.user.username,
                total_transactions: req.body.transactions?.length || 0,
                duplicates_found: 0,
                transactions_imported: 0,
                status: 'FAILED',
                remarks: error.message
            });
        } catch (historyError) {
            console.error('Error recording upload history:', historyError);
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},

/**
 * GET - Get upload history for location and bank
 */
getUploadHistory: async (req, res) => {
    try {
        const locationCode = req.user.location_code;
        const bankId = req.query.bank_id ? parseInt(req.query.bank_id) : null;
        const limit = req.query.limit ? parseInt(req.query.limit) : 10;

        const history = await bankReconDao.getUploadHistory(locationCode, bankId, limit);

        res.json({
            success: true,
            history: history
        });

    } catch (error) {
        console.error('Error in getUploadHistory:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},




};


// Helper function to convert Excel column letter to index
function columnToIndex(column) {
    if (typeof column === 'number') return column;
    
    let index = 0;
    for (let i = 0; i < column.length; i++) {
        index = index * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return index - 1;
}

// Helper function to parse Excel date
// function parseExcelDate(value) {
//     if (!value) return null;
    
//     // If it's a number (Excel serial date)
//     if (typeof value === 'number') {
//         const XLSX = require('xlsx');
//         const date = XLSX.SSF.parse_date_code(value);
//         return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
//     }
    
//     // If it's already a string, try to parse it
//     if (typeof value === 'string') {

//            // ===== NEW: Handle SBI format "1 Jan 2026" or "01 Jan 2026" =====
//         if (value.match(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)) {
//             const parts = value.trim().split(/\s+/);
//             if (parts.length === 3) {
//                 const monthMap = {
//                     'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
//                     'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
//                     'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
//                 };
//                 const day = parts[0].padStart(2, '0');
//                 const month = monthMap[parts[1]];
//                 const year = parts[2];
                
//                 if (month) {
//                     return `${year}-${month}-${day}`;
//                 }
//             }
//         }
//         // ===== END NEW CODE =====

//         // Handle DD-MMM-YYYY format (02-Apr-2025)
//         if (value.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}$/)) {
//             const parts = value.split('-');
//             const monthMap = {
//                 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
//                 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
//                 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
//             };
//             const month = monthMap[parts[1]];
//             return `${parts[2]}-${month}-${parts[0].padStart(2, '0')}`;
//         }
        
//         // Handle DD.MM.YY format (01.12.25) - IOCL SAP format
//         if (value.match(/^\d{1,2}\.\d{1,2}\.\d{2}$/)) {
//             const parts = value.split('.');
//             const day = parts[0].padStart(2, '0');
//             const month = parts[1].padStart(2, '0');
//             const year = '20' + parts[2]; // Assume 2000s
//             return `${year}-${month}-${day}`;
//         }
        
//         // Handle DD.MM.YYYY format (01.12.2025) - IOCL SAP format with full year
//         if (value.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
//             const parts = value.split('.');
//             const day = parts[0].padStart(2, '0');
//             const month = parts[1].padStart(2, '0');
//             const year = parts[2];
//             return `${year}-${month}-${day}`;
//         }
        
//         // Handle MM/DD/YY format (11/13/25)
//         if (value.match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
//             const parts = value.split('/');
//             const month = parts[0].padStart(2, '0');
//             const day = parts[1].padStart(2, '0');
//             const year = '20' + parts[2]; // Assume 2000s
//             return `${year}-${month}-${day}`;
//         }
        
//         // Handle MM/DD/YYYY format (11/13/2025)
//         if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
//             const parts = value.split('/');
//             const month = parts[0].padStart(2, '0');
//             const day = parts[1].padStart(2, '0');
//             const year = parts[2];
//             return `${year}-${month}-${day}`;
//         }
        
//         // Handle DD/MM/YYYY format (13/11/2025)
//         if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/) && parseInt(value.split('/')[0]) > 12) {
//             const parts = value.split('/');
//             const day = parts[0].padStart(2, '0');
//             const month = parts[1].padStart(2, '0');
//             const year = parts[2];
//             return `${year}-${month}-${day}`;
//         }
        
//         // Handle YYYY-MM-DD format (already correct)
//         if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
//             return value;
//         }
//     }
    
//     // If all else fails, try JavaScript Date parse
//     try {
//         const d = new Date(value);
//         if (!isNaN(d.getTime())) {
//             return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
//         }
//     } catch (e) {
//         console.error('Date parse error:', value, e);
//     }
    
//     return null;
// }

function parseExcelDate(value, dateFormat = 'AUTO') {
    if (!value) return null;
    
    // Excel serial number
    if (typeof value === 'number') {
        const XLSX = require('xlsx');
        const date = XLSX.SSF.parse_date_code(value);
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    
    if (typeof value !== 'string') return null;
    
    const v = value.trim();
    
    // Month name mapping
    const monthMap = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    
    // Try specific format if provided
    if (dateFormat && dateFormat !== 'AUTO') {
        switch(dateFormat) {
            case 'DD.MM.YY':
                // 06.02.26 → 2026-02-06
                if (v.match(/^\d{1,2}\.\d{1,2}\.\d{2}$/)) {
                    const [day, month, year] = v.split('.');
                    return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
                break;
                
            case 'DD.MM.YYYY':
                // 06.02.2026 → 2026-02-06
                if (v.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                    const [day, month, year] = v.split('.');
                    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
                break;
                
            case 'DD-MMM-YYYY':
                // 11-Feb-2026 → 2026-02-11
                if (v.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}$/)) {
                    const [day, monthName, year] = v.split('-');
                    const month = monthMap[monthName];
                    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
                }
                break;
                
            case 'DD MMM YYYY':
                // 1 Jan 2026 → 2026-01-01
                if (v.match(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)) {
                    const [day, monthName, year] = v.split(/\s+/);
                    const month = monthMap[monthName];
                    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
                }
                break;
                
            case 'DD/MM/YYYY':
                // 01/02/2026 → 2026-02-01
                if (v.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                    const [day, month, year] = v.split('/');
                    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
                break;
                
            case 'MM/DD/YYYY':
                // 02/01/2026 → 2026-02-01
                if (v.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                    const [month, day, year] = v.split('/');
                    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
                break;
            case 'DD/MM/YY':
                // 01/01/26 → 2026-01-01 (HDFC)
                if (v.match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
                    const [day, month, year] = v.split('/');
                    return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }
                break;    
        }
    }
    
    // Fallback to auto-detection
    
    // DD.MM.YY (IOCL)
    if (v.match(/^\d{1,2}\.\d{1,2}\.\d{2}$/)) {
        const [day, month, year] = v.split('.');
        return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // DD.MM.YYYY
    if (v.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
        const [day, month, year] = v.split('.');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // DD-MMM-YYYY (IOB)
    if (v.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}$/)) {
        const [day, monthName, year] = v.split('-');
        const month = monthMap[monthName];
        if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
    }
    
    // DD MMM YYYY (SBI)
    if (v.match(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)) {
        const [day, monthName, year] = v.split(/\s+/);
        const month = monthMap[monthName];
        if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
    }

    // DD/MM/YY (HDFC) - 01/01/26
    if (v.match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
        const [day, month, year] = v.split('/');
        return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // DD/MM/YYYY vs MM/DD/YYYY (ambiguous)
    if (v.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const [first, second, year] = v.split('/');
        if (parseInt(first) > 12) {
            return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
        }
        if (parseInt(second) > 12) {
            return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
        }
        // Default to DD/MM/YYYY for Indian banks
        return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    }
    
    // YYYY-MM-DD
    if (v.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return v;
    }
    
    // Last resort
    try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    } catch (e) {
        console.error('Date parse error:', value, e);
    }
    
    return null;
}


function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function columnToIndex(column) {
    if (!column) return -1;
    const col = column.toUpperCase();
    let result = 0;
    for (let i = 0; i < col.length; i++) {
        result = result * 26 + (col.charCodeAt(i) - 64);
    }
    return result - 1;
}



/**
 * Validate that uploaded file is for the correct bank account
 * by checking if overlap transactions match existing data
 * ENHANCED: Also checks running balance when available
 */
async function validateAccountByTransactionMatch(bankId, uploadedTransactions, lastUploadedDate) {
    // Skip validation if first upload (no previous data)
    if (!lastUploadedDate) {
        console.log('Account validation: First upload - skipping validation');
        return { 
            isValid: true, 
            reason: 'first_upload' 
        };
    }
    
    // Get transactions from the overlap date(s)
    const lastDate = new Date(lastUploadedDate);
    const dayBefore = new Date(lastDate);
    dayBefore.setDate(lastDate.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().split('T')[0];
    
    const overlapTxns = uploadedTransactions.filter(txn => 
        txn.txn_date === lastUploadedDate || 
        txn.txn_date === dayBeforeStr
    );
    
    if (overlapTxns.length === 0) {
        console.log('Account validation: No transactions in overlap period');
        return { 
            isValid: true, 
            reason: 'no_overlap_transactions',
            warning: 'Could not validate account - no overlap transactions'
        };
    }
    
    console.log(`Account validation: Checking ${overlapTxns.length} overlap transactions`);
    
    // Check each transaction individually (NOT totals)
    let matchCount = 0;
    let balanceMatchCount = 0;
    let hasBalanceInUpload = false;
    
    for (const uploadTxn of overlapTxns) {
        // Check if upload has balance
        const uploadBalance = uploadTxn.balance_amount || null;
        if (uploadBalance !== null && uploadBalance !== 0) {
            hasBalanceInUpload = true;
        }
        
        // Check transaction with optional balance
        const checkResult = await bankReconDao.checkTransactionExists(
            bankId,
            uploadTxn.txn_date,
            uploadTxn.credit_amount,
            uploadTxn.debit_amount,
            uploadBalance
        );
        
        if (checkResult.exists) {
            matchCount++;
            
            if (checkResult.hasRunningBalance && uploadBalance !== null) {
                balanceMatchCount++;
                console.log(`✓ EXACT Match (with balance): ${uploadTxn.txn_date} - Credit: ${uploadTxn.credit_amount}, Debit: ${uploadTxn.debit_amount}, Balance: ${uploadBalance}`);
            } else {
                console.log(`✓ Match (amount only): ${uploadTxn.txn_date} - Credit: ${uploadTxn.credit_amount}, Debit: ${uploadTxn.debit_amount}`);
            }
            
            // Found at least one match - this is enough!
            break;
        }
    }
    
    // Validation failed if no matches found
    if (matchCount === 0) {
        console.log(`✗ Account validation FAILED: No matching transactions found`);
        return { 
            isValid: false, 
            reason: 'no_matching_transactions',
            overlapDate: lastUploadedDate,
            overlapCount: overlapTxns.length,
            message: `No matching transactions found from ${formatDateForDisplay(lastUploadedDate)}. This file appears to be for a different bank account.`
        };
    }
    
    // Validation passed
    const validationResult = {
        isValid: true, 
        reason: 'matched',
        matchCount: matchCount,
        totalOverlap: overlapTxns.length,
        balanceValidated: balanceMatchCount > 0,
        hasBalanceInUpload: hasBalanceInUpload
    };
    
    if (balanceMatchCount > 0) {
        console.log(`✓ Account validation PASSED with BALANCE verification: ${matchCount} transaction(s) matched, ${balanceMatchCount} with balance`);
    } else if (hasBalanceInUpload) {
        console.log(`✓ Account validation PASSED (no running balance in DB for comparison)`);
    } else {
        console.log(`✓ Account validation PASSED (amount match only, no balance in upload)`);
    }
    
    return validationResult;
}


async function validateStatementAccountMatch(bankId, locationCode, uploadedTransactions, lastUploadedDate) {
    // Skip if first upload
    if (!lastUploadedDate) {
        console.log('Statement account validation: First upload - skipping');
        return { isValid: true, reason: 'first_upload' };
    }
    
    // Get overlap transactions (last uploaded date and day before)
    const lastDate = new Date(lastUploadedDate);
    const dayBefore = new Date(lastDate);
    dayBefore.setDate(lastDate.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().split('T')[0];
    
    const overlapTxns = uploadedTransactions.filter(txn =>
        txn.txn_date === lastUploadedDate ||
        txn.txn_date === dayBeforeStr
    );
    
    if (overlapTxns.length === 0) {
        console.log('Statement account validation: No overlap transactions found');
        return {
            isValid: true,
            reason: 'no_overlap_transactions',
            warning: 'Could not validate account - no overlap transactions'
        };
    }
    
    console.log(`Statement account validation: Checking ${overlapTxns.length} overlap transactions`);
    
    let matchCount = 0;
    let balanceMatchCount = 0;
    
    for (const uploadTxn of overlapTxns) {
        const uploadBalance = uploadTxn.balance_amount || null;
        
        const checkResult = await bankReconDao.checkStatementTransactionExists(
            bankId,
            locationCode,
            uploadTxn.txn_date,
            uploadTxn.credit_amount,
            uploadTxn.debit_amount,
            uploadBalance
        );
        
        if (checkResult.exists) {
            matchCount++;
            if (checkResult.hasBalance && uploadBalance) {
                balanceMatchCount++;
                console.log(`Match (with balance): ${uploadTxn.txn_date} C:${uploadTxn.credit_amount} D:${uploadTxn.debit_amount} B:${uploadBalance}`);
            } else {
                console.log(`Match (amount only): ${uploadTxn.txn_date} C:${uploadTxn.credit_amount} D:${uploadTxn.debit_amount}`);
            }
            break; // One match is enough
        }
    }
    
    if (matchCount === 0) {
        console.log('Statement account validation FAILED: No matching transactions');
        return {
            isValid: false,
            reason: 'no_matching_transactions',
            overlapDate: lastUploadedDate,
            overlapCount: overlapTxns.length,
            message: `No matching transactions found from ${formatDateForDisplay(lastUploadedDate)}. This file appears to be for a different bank account.`
        };
    }
    
    console.log(`Statement account validation PASSED: ${matchCount} match(es), ${balanceMatchCount} with balance`);
    return {
        isValid: true,
        reason: 'matched',
        matchCount,
        balanceValidated: balanceMatchCount > 0
    };
}






