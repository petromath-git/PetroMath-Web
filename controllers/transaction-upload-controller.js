// controllers/transaction-upload-controller.js
const BankStatementDao = require('../dao/bank-statement-dao');
const bankReconDao = require('../dao/bank-reconciliation-dao');

// Helper function to convert Excel column letter to index
function columnToIndex(column) {
    if (typeof column === 'number') return column;
    
    let index = 0;
    for (let i = 0; i < column.length; i++) {
        index = index * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return index - 1;
}

// Helper function to parse Excel date - COMPLETE VERSION
function parseExcelDate(value) {
    if (!value) return null;
    
    // If it's a number (Excel serial date)
    if (typeof value === 'number') {
        const XLSX = require('xlsx');
        const date = XLSX.SSF.parse_date_code(value);
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    
    // If it's already a string, try to parse it
    if (typeof value === 'string') {

           // ===== NEW: Handle SBI format "1 Jan 2026" or "01 Jan 2026" =====
        if (value.match(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)) {
            const parts = value.trim().split(/\s+/);
            if (parts.length === 3) {
                const monthMap = {
                    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                };
                const day = parts[0].padStart(2, '0');
                const month = monthMap[parts[1]];
                const year = parts[2];
                
                if (month) {
                    return `${year}-${month}-${day}`;
                }
            }
        }
        // ===== END NEW CODE =====


        // Handle DD-MMM-YYYY format (02-Apr-2025)
        if (value.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}$/)) {
            const parts = value.split('-');
            const monthMap = {
                'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
            };
            const month = monthMap[parts[1]];
            return `${parts[2]}-${month}-${parts[0].padStart(2, '0')}`;
        }
        
        // Handle DD.MM.YY format (01.12.25) - IOCL SAP format
        if (value.match(/^\d{1,2}\.\d{1,2}\.\d{2}$/)) {
            const parts = value.split('.');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = '20' + parts[2]; // Assume 2000s
            return `${year}-${month}-${day}`;
        }
        
        // Handle DD.MM.YYYY format (01.12.2025) - IOCL SAP format with full year
        if (value.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
            const parts = value.split('.');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`;
        }
        
        // Handle MM/DD/YY format (11/13/25)
        if (value.match(/^\d{1,2}\/\d{1,2}\/\d{2}$/)) {
            const parts = value.split('/');
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            const year = '20' + parts[2]; // Assume 2000s
            return `${year}-${month}-${day}`;
        }
        
        // Handle MM/DD/YYYY format (11/13/2025)
        if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
            const parts = value.split('/');
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`;
        }
        
        // Handle DD/MM/YYYY format (13/11/2025)
        if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/) && parseInt(value.split('/')[0]) > 12) {
            const parts = value.split('/');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`;
        }
        
        // Handle YYYY-MM-DD format (already correct)
        if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return value;
        }
    }
    
    // If all else fails, try JavaScript Date parse
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

// NEW: Helper function to format date as DD-MM-YYYY
function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    
    // Input: YYYY-MM-DD
    // Output: DD-MM-YYYY
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
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


module.exports = {
    /**
     * GET - Render the Transaction Upload page (Step 1)
     */
   getUploadPage: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const locationConfigDao = require('../dao/location-config-dao');
        
        // Get overlap configuration
        const overlapMode = await locationConfigDao.getSetting(
            locationCode,
            'BANK_STATEMENT_OVERLAP_MODE'
        ) || 'off';
        
        const overlapDays = parseInt(
            await locationConfigDao.getSetting(
                locationCode,
                'BANK_STATEMENT_OVERLAP_DAYS  '
            ) || '1'
        );
        
        const banks = await bankReconDao.getBanksForReconciliation(locationCode);
        
        // Get last upload dates for all banks (only if overlap is enabled)
        let banksWithLastUpload = banks;
        if (overlapMode !== 'off') {
            banksWithLastUpload = await Promise.all(
                banks.map(async (bank) => {
                    const lastDate = await bankReconDao.getLastTransactionDate(locationCode, bank.bank_id);
                    return {
                        ...bank,
                        last_upload_date: lastDate
                    };
                })
            );
        }
        
        res.render('transaction-upload', {
            title: 'Upload Transactions',
            user: req.user,
            banks: banksWithLastUpload,
            overlapMode: overlapMode,
            overlapDays: overlapDays
        });
        
    } catch (error) {
        console.error('Error in getUploadPage:', error);
        next(error);
    }
},

    /**
 * POST - Upload and preview transactions (Step 2)
 * UPDATED: Added overlap validation to prevent missing transactions
 */
previewTransactions: async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const locationCode = req.user.location_code;
        const bankId = parseInt(req.body.bank_id);
        const locationConfigDao = require('../dao/location-config-dao');

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const template = await bankReconDao.getBankTemplate(bankId);
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'No template found for this bank. Please configure in Bank Reconciliation first.'
            });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        // ========== STEP 1: Parse all dates first to find earliest date ==========
        const tempDates = [];
        for (let i = template.data_start_row - 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;
            
            const txnDate = parseExcelDate(row[columnToIndex(template.value_date_column || template.date_column)]);
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
        
        const lastUploadedDate = await bankReconDao.getLastTransactionDate(locationCode, bankId);
        
        if (lastUploadedDate && overlapMode !== 'off') {
            const lastDate = new Date(lastUploadedDate);
            const uploadDate = new Date(earliestUploadDate);
            
            const expectedOverlapDate = new Date(lastDate);
            expectedOverlapDate.setDate(lastDate.getDate() - (overlapDays - 1));
            
            const hasOverlap = uploadDate <= lastDate;
            const meetsOverlapRequirement = uploadDate <= expectedOverlapDate;
            
            console.log('=== Overlap Validation (Transaction Upload) ===');
            console.log('Last uploaded date:', lastUploadedDate);
            console.log('Earliest upload date:', earliestUploadDate);
            console.log('Required overlap days:', overlapDays);
            console.log('Expected overlap date:', expectedOverlapDate.toISOString().split('T')[0]);
            console.log('Has overlap:', hasOverlap);
            console.log('Meets requirement:', meetsOverlapRequirement);
            
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
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

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

            const txnDate = parseExcelDate(row[columnToIndex(template.value_date_column || template.date_column)]);
            
            if (excludeToday && txnDate > yesterdayStr) {
                excludedTodayCount.push(txnDate);
                continue;
            }

            const debitRaw = row[columnToIndex(template.debit_column)] || '';
            const creditRaw = row[columnToIndex(template.credit_column)] || '';
            const balanceRaw = row[columnToIndex(template.balance_column)] || '';

            const txn = {
                txn_date: txnDate,
                description: row[columnToIndex(template.description_column)] || '',
                debit_amount: parseFloat(String(debitRaw).replace(/,/g, '')) || 0,
                credit_amount: parseFloat(String(creditRaw).replace(/,/g, '')) || 0,
                balance_amount: parseFloat(String(balanceRaw).replace(/,/g, '')) || 0,
                running_balance: parseFloat(String(balanceRaw).replace(/,/g, '')) || null,
                statement_ref: row[columnToIndex(template.reference_column)] || null,
                source_file: req.file.originalname,
                ledger_name: null,
                remarks: row[columnToIndex(template.description_column)] || ''
            };

            if (txn.debit_amount === 0 && txn.credit_amount === 0) continue;

            transactions.push(txn);
        }

        if (transactions.length === 0) {
            return res.json({
                success: false,
                error: 'No valid transactions found in the uploaded file.'
            });
        }

        // Check transaction limit
        if (transactions.length > 1000) {
            return res.json({
                success: false,
                error: `Too many transactions (${transactions.length}). Maximum 1,000 transactions per upload. Please split your file into smaller batches.`
            });
        }

        // ========== STEP 5: Account Validation (Prevent Wrong Account Upload) ==========

        const accountValidation = await validateAccountByTransactionMatch(
            bankId,
            transactions,  // ✅ Now transactions exists!
            lastUploadedDate
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
        
        const duplicates = await checkTransactionDuplicates(bankId, transactions);

        const transactionsWithDupFlag = transactions.map(txn => {
            const uploadAmount = txn.credit_amount > 0 ? txn.credit_amount : txn.debit_amount;
            const uploadType = txn.credit_amount > 0 ? 'credit' : 'debit';
            
            const isDup = duplicates.some(dup => 
                dup.uploaded_date === txn.txn_date && 
                Math.abs(dup.amount - uploadAmount) < 0.01 &&
                dup.type === uploadType
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
                yesterday_date: yesterdayStr,
                last_uploaded_date: lastUploadedDate,
                earliest_upload_date: earliestUploadDate,
                latest_upload_date: latestUploadDate,
                overlap_mode: overlapMode,
                has_gap: lastUploadedDate && earliestUploadDate > lastUploadedDate
            }
        });

    } catch (error) {
        console.error('Error in previewTransactions:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},


    /**
     * POST - Save transactions with ledgers (Step 3)
     */
    saveTransactions: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const bankId = parseInt(req.body.bank_id);
            const transactions = req.body.transactions;
            const userName = req.user.User_Name || req.user.username || req.user.user_id;

            if (!transactions || transactions.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No transactions to save'
                });
            }

            // Validate
            for (let i = 0; i < transactions.length; i++) {
                const txn = transactions[i];
                
                if (!txn.ledger_name) {
                    return res.status(400).json({
                        success: false,
                        error: `Transaction ${i + 1} is missing ledger selection`
                    });
                }
                
                const credit = parseFloat(txn.credit_amount) || 0;
                const debit = parseFloat(txn.debit_amount) || 0;
                
                if (credit === 0 && debit === 0) {
                    return res.status(400).json({
                        success: false,
                        error: `Transaction ${i + 1}: Must have either credit or debit amount`
                    });
                }
            }

            let successCount = 0;
            let failedEntries = [];

            // Save each transaction
            for (let i = 0; i < transactions.length; i++) {
                const txn = transactions[i];
                
                try {
                    const credit = parseFloat(txn.credit_amount) || 0;
                    const debit = parseFloat(txn.debit_amount) || 0;

                   // Lookup external_id and external_source from allowed ledgers
                    let externalId = null;
                    let externalSource = null;

                    if (txn.ledger_name && bankId) {
                        try {
                            const ledgerDetails = await BankStatementDao.getLedgerDetails(
                                bankId, 
                                txn.ledger_name, 
                                locationCode
                            );
                            
                            if (ledgerDetails) {
                                externalId = ledgerDetails.external_id;
                                externalSource = ledgerDetails.source_type;
                                console.log(`Mapped ledger ${txn.ledger_name} → external_id: ${externalId}, source: ${externalSource}`);
                            } else {
                                console.warn(`No ledger details found for ${txn.ledger_name}, bank ${bankId}`);
                            }
                        } catch (ledgerError) {
                            console.error('Error looking up ledger details:', ledgerError);
                        }
                    }

                    const transactionData = {
                        trans_date: txn.txn_date,
                        bank_id: parseInt(bankId),
                        ledger_name: txn.ledger_name,
                        transaction_type: null,
                        accounting_type: null,
                        credit_amount: credit > 0 ? credit : null,
                        debit_amount: debit > 0 ? debit : null,
                        remarks: txn.remarks || txn.description || '',
                        external_id: externalId,  // ✓ Now properly populated
                        external_source: externalSource || 'upload',  // ✓ Use source_type or fallback to 'upload'
                        running_balance: txn.running_balance || null,
                        created_by: userName
                    };

                    await BankStatementDao.saveTransaction(transactionData);
                    
                    // Learn pattern
                    try {
                        const entryType = credit > 0 ? 'CREDIT' : 'DEBIT';
                        await bankReconDao.learnFromSuggestion(
                            bankId,
                            txn.description || '',
                            txn.ledger_name,
                            entryType
                        );
                    } catch (learningError) {
                        console.error('Learning error (non-critical):', learningError);
                    }

                    successCount++;
                } catch (error) {
                    console.error(`Error saving transaction ${i + 1}:`, error);
                    failedEntries.push({
                        index: i + 1,
                        transaction: txn,
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
                    message: `${successCount} transactions saved, ${failedEntries.length} failed`
                });
            }

            res.json({
                success: true,
                count: successCount,
                message: `${successCount} transactions uploaded successfully`
            });

        } catch (error) {
            console.error('Error in saveTransactions:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    },

    /**
     * GET - Get ledgers with AI suggestion
     */
    getLedgersWithSuggestion: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const bankId = parseInt(req.query.bank_id);
            const description = req.query.description || '';
            const entryType = req.query.entry_type || 'BOTH';
            
            if (!bankId) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Bank ID is required' 
                });
            }
            
            const allLedgers = await BankStatementDao.getAllowedLedgers(bankId, locationCode);
            
            const filteredLedgers = allLedgers.filter(ledger => {
                if (entryType === 'BOTH') return true;
                return ledger.allowed_entry_type === 'BOTH' || ledger.allowed_entry_type === entryType;
            });
            
            let suggestedLedgerName = null;
            if (description) {
                const suggestion = await bankReconDao.getSuggestedLedger(bankId, description, entryType);
                if (suggestion) {
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
    }
};


function getDateDifference(date1Str, date2Str) {
    // date1Str is YYYY-MM-DD format (uploaded transaction)
    // date2Str can be YYYY-MM-DD format (from database)
    const parseDate = (dateStr) => {
        if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            // Check if format is YYYY-MM-DD or DD-MM-YYYY
            if (parts[0].length === 4) {
                // YYYY-MM-DD
                return new Date(parts[0], parts[1] - 1, parts[2]);
            } else {
                // DD-MM-YYYY
                return new Date(parts[2], parts[1] - 1, parts[0]);
            }
        }
        return new Date(dateStr);
    };
    
    const d1 = parseDate(date1Str);
    const d2 = parseDate(date2Str);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}



async function checkTransactionDuplicates(bankId, transactions) {
    if (!transactions || transactions.length === 0) {
        return [];
    }
    
    try {
        const db = require('../db/db-connection');
        
        // Get ALL transactions from t_bank_transaction for this bank
        const query = `
            SELECT 
                t_bank_id,
                DATE_FORMAT(trans_date, '%Y-%m-%d') as trans_date,
                credit_amount,
                debit_amount,
                remarks,
                ledger_name
            FROM t_bank_transaction
            WHERE bank_id = ?
            ORDER BY trans_date DESC
        `;
        
        const existingTransactions = await db.sequelize.query(query, {
            replacements: [bankId],
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        console.log(`Found ${existingTransactions.length} existing transactions to check against`);
        
        // DEBUG: Log first few existing transactions
        if (existingTransactions.length > 0) {
            console.log('Sample existing transactions:');
            existingTransactions.slice(0, 3).forEach(txn => {
                console.log(`  Date: ${txn.trans_date}, Credit: ${txn.credit_amount}, Debit: ${txn.debit_amount}`);
            });
        }
        
        // Convert to proper format
        existingTransactions.forEach(txn => {
            txn.credit_amount = parseFloat(txn.credit_amount) || 0;
            txn.debit_amount = parseFloat(txn.debit_amount) || 0;
        });
        
        // DEBUG: Log first few uploaded transactions
        if (transactions.length > 0) {
            console.log('Sample uploaded transactions:');
            transactions.slice(0, 3).forEach(txn => {
                console.log(`  Date: ${txn.txn_date}, Credit: ${txn.credit_amount}, Debit: ${txn.debit_amount}`);
            });
        }
        
        // Track which existing transactions have been matched
        const matchedExistingIds = new Set();
        const duplicates = [];
        
        // PHASE 1: For each uploaded transaction, try to find a match in existing
        transactions.forEach(uploadedTxn => {
            const uploadAmount = uploadedTxn.credit_amount > 0 ? uploadedTxn.credit_amount : uploadedTxn.debit_amount;
            const uploadType = uploadedTxn.credit_amount > 0 ? 'credit' : 'debit';
            
            // First try: EXACT date match
            let matchInfo = existingTransactions.find(existingTxn => {
                // Skip if already matched
                if (matchedExistingIds.has(existingTxn.t_bank_id)) return false;
                
                const existingAmount = uploadType === 'credit' ? existingTxn.credit_amount : existingTxn.debit_amount;
                
                // Both dates should be in YYYY-MM-DD format now
                const uploadDate = uploadedTxn.txn_date; // YYYY-MM-DD
                const existingDate = existingTxn.trans_date; // YYYY-MM-DD from DATE_FORMAT
                
                const dateMatch = uploadDate === existingDate;
                const amountMatch = Math.abs(uploadAmount - existingAmount) < 0.01;
                
                // DEBUG first transaction
                if (existingTransactions.indexOf(existingTxn) === 0 && transactions.indexOf(uploadedTxn) === 0) {
                    console.log(`Exact match check: ${uploadDate} === ${existingDate}? ${dateMatch}, Amount match: ${amountMatch}`);
                }
                
                return amountMatch && dateMatch;
            });
            
            // Second try: ±1 day tolerance
            if (!matchInfo) {
                matchInfo = existingTransactions.find(existingTxn => {
                    // Skip if already matched
                    if (matchedExistingIds.has(existingTxn.t_bank_id)) return false;
                    
                    const existingAmount = uploadType === 'credit' ? existingTxn.credit_amount : existingTxn.debit_amount;
                    const amountMatch = Math.abs(uploadAmount - existingAmount) < 0.01;
                    
                    if (!amountMatch) return false;
                    
                    // Check if dates are within ±1 day
                    const dateDiff = getDateDifference(uploadedTxn.txn_date, existingTxn.trans_date);
                    
                    // DEBUG
                    if (dateDiff <= 1 && existingTransactions.indexOf(existingTxn) < 3) {
                        console.log(`Near match: ${uploadedTxn.txn_date} vs ${existingTxn.trans_date}, diff: ${dateDiff} days`);
                    }
                    
                    return dateDiff <= 1;
                });
            }
            
            if (matchInfo) {
                // Mark as matched
                matchedExistingIds.add(matchInfo.t_bank_id);
                duplicates.push({
                    uploaded_date: uploadedTxn.txn_date,
                    existing_date: matchInfo.trans_date,
                    amount: uploadAmount,
                    type: uploadType,
                    matched_id: matchInfo.t_bank_id,
                    ledger_name: matchInfo.ledger_name
                });
                
                console.log(`DUPLICATE FOUND: ${uploadedTxn.txn_date} - ${uploadAmount} (${uploadType}) matches existing ${matchInfo.trans_date}`);
            }
        });
        
        console.log(`checkTransactionDuplicates: Found ${duplicates.length} duplicates out of ${transactions.length} transactions`);
        return duplicates;
        
    } catch (error) {
        console.error('Error in checkTransactionDuplicates:', error);
        throw error;
    }
}



