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
            const banks = await bankReconDao.getBanksForReconciliation(locationCode);

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
                external_source
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

        // Get yesterday's date (exclude today's transactions)
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        // Skip header row and parse transactions
        const transactions = [];
        const excludedTodayCount = [];
        
        for (let i = template.data_start_row - 1; i < data.length; i++) {
            const row = data[i];
            
            // Skip empty rows
            if (!row || row.length === 0) continue;

            const txnDate = parseExcelDate(row[columnToIndex(template.value_date_column || template.date_column)]);
            
            // Skip transactions from today or future
            if (txnDate > yesterdayStr) {
                excludedTodayCount.push(txnDate);
                continue;
            }

            const txn = {
                txn_date: txnDate,
                description: row[columnToIndex(template.description_column)] || '',
                debit_amount: parseFloat(row[columnToIndex(template.debit_column)]) || 0,
                credit_amount: parseFloat(row[columnToIndex(template.credit_column)]) || 0,
                balance_amount: parseFloat(row[columnToIndex(template.balance_column)]) || 0,
                statement_ref: row[columnToIndex(template.reference_column)] || null,
                source_file: req.file.originalname
            };

            // Skip rows with no amounts
            if (txn.debit_amount === 0 && txn.credit_amount === 0) continue;

            transactions.push(txn);
        }

        // Check for duplicates
        const duplicates = await bankReconDao.checkDuplicates(locationCode, bankId, transactions);

        // Mark transactions as duplicates (for UI)
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

        res.json({
            success: true,
            transactions: transactionsWithDupFlag,
            duplicates: duplicates,
            summary: {
                total: transactions.length,
                duplicates: duplicates.length,
                excluded_today: excludedTodayCount.length,
                yesterday_date: yesterdayStr
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


function parseExcelDate(excelDate) {
    if (!excelDate) return null;
    
    // If already in YYYY-MM-DD format
    if (typeof excelDate === 'string' && excelDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return excelDate;
    }
    
    // If Excel serial number (numeric)
    if (typeof excelDate === 'number') {
        const date = new Date((excelDate - 25569) * 86400 * 1000);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // If string date format
    if (typeof excelDate === 'string') {
        // Handle format: 2025-Apr-02
        if (excelDate.match(/^\d{4}-[A-Za-z]{3}-\d{2}$/)) {
            const parts = excelDate.split('-');
            const year = parts[0];
            const monthStr = parts[1];
            const day = parts[2];
            
            const monthMap = {
                'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
            };
            
            const month = monthMap[monthStr];
            if (month) {
                return `${year}-${month}-${day}`;
            }
        }
        
        // Handle DD-MM-YYYY or DD/MM/YYYY format
        if (excelDate.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/)) {
            const parts = excelDate.split(/[-/]/);
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`;
        }
        
        // Handle YYYY-MM-DD format with different separators
        if (excelDate.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/)) {
            const parts = excelDate.split(/[-/]/);
            const year = parts[0];
            const month = parts[1].padStart(2, '0');
            const day = parts[2].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        
        // Try parsing as a standard date string
        try {
            const date = new Date(excelDate);
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        } catch (e) {
            console.error('Error parsing date:', excelDate, e);
        }
    }
    
    console.error('Unable to parse date:', excelDate);
    return null;
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








