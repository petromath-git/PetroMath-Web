const db = require("../db/db-connection");
const Sequelize = db.Sequelize;

module.exports = {
    
/**
 * Get list of banks for reconciliation (internal OR oil company)
 */
getBanksForReconciliation: async (locationCode) => {
    const result = await db.sequelize.query(
        `SELECT 
            bank_id, 
            bank_name, 
            account_number, 
            account_nickname,
            internal_flag,
            is_oil_company
         FROM m_bank
         WHERE location_code = :locationCode
           AND active_flag = 'Y'
           AND (internal_flag = 'Y' OR is_oil_company = 'Y')
         ORDER BY 
            CASE 
                WHEN internal_flag = 'Y' THEN 0
                ELSE 1
            END,
            bank_name, 
            account_nickname`,
        {
            replacements: { locationCode },
            type: Sequelize.QueryTypes.SELECT
        }
    );
    return result;
},


    /**
     * Get system transactions (from t_bank_transaction)
     */
    getSystemTransactions: async (locationCode, fromDate, toDate, bankId) => {
        const result = await db.sequelize.query(
            `SELECT 
                bt.t_bank_id,
                DATE_FORMAT(bt.trans_date, '%d-%m-%Y') as trans_date,
                bt.trans_date as sort_date,
                bt.remarks,
                bt.ledger_name,
                bt.debit_amount,
                bt.credit_amount,
                (SELECT COUNT(*) FROM t_receipts WHERE source_txn_id = bt.t_bank_id) as receipt_count,
                bt.recon_match_id as digital_recon_id,
                bt.created_by,
                bt.creation_date
             FROM t_bank_transaction bt
             JOIN m_bank mb ON bt.bank_id = mb.bank_id
             WHERE mb.location_code = :locationCode
               AND bt.bank_id = :bankId
               AND bt.trans_date BETWEEN :fromDate AND :toDate
             ORDER BY bt.trans_date,
                      CASE WHEN bt.credit_amount > 0 THEN 0 ELSE 1 END,
                      bt.credit_amount DESC,
                      bt.debit_amount DESC`,
            {
                replacements: { locationCode, fromDate, toDate, bankId },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result;
    },

    /**
     * Get bank statement transactions (from t_bank_statement_actual)
     */
    getBankTransactions: async (locationCode, fromDate, toDate, bankId) => {
        const result = await db.sequelize.query(
            `SELECT 
                a.actual_stmt_id,
                DATE_FORMAT(a.txn_date, '%d-%m-%Y') as txn_date,
                a.txn_date as sort_date,
                a.description,
                a.debit_amount,
                a.credit_amount,
                a.balance_amount,
                a.statement_ref,
                a.source_file,
                a.created_by,
                a.creation_date
             FROM t_bank_statement_actual a
             JOIN m_bank mb ON a.bank_id = mb.bank_id
             WHERE a.location_code = :locationCode
               AND a.bank_id = :bankId
               AND a.txn_date BETWEEN :fromDate AND :toDate
             ORDER BY a.txn_date,
                      CASE WHEN a.credit_amount > 0 THEN 0 ELSE 1 END,
                      a.credit_amount DESC,
                      a.debit_amount DESC`,
            {
                replacements: { locationCode, fromDate, toDate, bankId },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result;
    },

    /**
     * Get summary totals
     */
    getSummaryTotals: async (locationCode, fromDate, toDate, bankId) => {
        const result = await db.sequelize.query(
            `SELECT 
                -- System totals
                CAST(COALESCE(SUM(bt.credit_amount), 0) AS DECIMAL(15,2)) as system_credit,
                CAST(COALESCE(SUM(bt.debit_amount), 0) AS DECIMAL(15,2)) as system_debit,
                COUNT(*) as system_count,
                
                -- Bank totals
                CAST((SELECT COALESCE(SUM(credit_amount), 0) 
                 FROM t_bank_statement_actual 
                 WHERE bank_id = :bankId 
                   AND location_code = :locationCode
                   AND txn_date BETWEEN :fromDate AND :toDate) AS DECIMAL(15,2)) as bank_credit,
                   
                CAST((SELECT COALESCE(SUM(debit_amount), 0) 
                 FROM t_bank_statement_actual 
                 WHERE bank_id = :bankId 
                   AND location_code = :locationCode
                   AND txn_date BETWEEN :fromDate AND :toDate) AS DECIMAL(15,2)) as bank_debit,
                   
                (SELECT COUNT(*) 
                 FROM t_bank_statement_actual 
                 WHERE bank_id = :bankId 
                   AND location_code = :locationCode
                   AND txn_date BETWEEN :fromDate AND :toDate) as bank_count
                
             FROM t_bank_transaction bt
             JOIN m_bank mb ON bt.bank_id = mb.bank_id
             WHERE mb.location_code = :locationCode
               AND bt.bank_id = :bankId
               AND bt.trans_date BETWEEN :fromDate AND :toDate`,
            {
                replacements: { locationCode, fromDate, toDate, bankId },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result[0];
    },

    /**
     * Get impact analysis for deleting a transaction
     */
    getTransactionImpact: async (txnId) => {
        // Get transaction details
        const transaction = await db.sequelize.query(
            `SELECT t_bank_id, trans_date, remarks, credit_amount, debit_amount, bank_id
             FROM t_bank_transaction
             WHERE t_bank_id = :txnId`,
            {
                replacements: { txnId },
                type: db.Sequelize.QueryTypes.SELECT
            }
        );

        if (!transaction || transaction.length === 0) {
            return null;
        }

        // Get linked receipts
        const receipts = await db.sequelize.query(
            `SELECT treceipt_id, receipt_no, amount, recon_match_id
             FROM t_receipts
             WHERE source_txn_id = :txnId`,
            {
                replacements: { txnId },
                type: db.Sequelize.QueryTypes.SELECT
            }
        );

        // Get recon_match_ids from receipts
        const reconIds = receipts
            .map(r => r.recon_match_id)
            .filter(id => id != null);

        // Get affected digital sales and adjustments
        let reconRecords = [];
        if (reconIds.length > 0) {
            const digitalSales = await db.sequelize.query(
                `SELECT 't_digital_sales' as source_table, digital_sales_id as source_id, amount
                 FROM t_digital_sales
                 WHERE recon_match_id IN (:reconIds)`,
                {
                    replacements: { reconIds },
                    type: db.Sequelize.QueryTypes.SELECT
                }
            );

            const adjustments = await db.sequelize.query(
                `SELECT 't_adjustments' as source_table, adjustment_id as source_id, 
                        COALESCE(credit_amount, debit_amount) as amount
                 FROM t_adjustments
                 WHERE recon_match_id IN (:reconIds)`,
                {
                    replacements: { reconIds },
                    type: db.Sequelize.QueryTypes.SELECT
                }
            );

            reconRecords = [...digitalSales, ...adjustments];
        }

        return {
            transaction: transaction[0],
            receipts: receipts,
            reconRecords: reconRecords
        };
    },

    /**
     * Delete transaction with cascade
     */
    deleteTransaction: async (txnId, userName) => {
        const t = await db.sequelize.transaction();

        try {
            // Get transaction details for audit trail
            const transaction = await db.sequelize.query(
                `SELECT * FROM t_bank_transaction WHERE t_bank_id = :txnId`,
                {
                    replacements: { txnId },
                    type: db.Sequelize.QueryTypes.SELECT,
                    transaction: t
                }
            );

            if (!transaction || transaction.length === 0) {
                throw new Error('Transaction not found');
            }

            // Get recon_match_ids from receipts before deleting
            const receipts = await db.sequelize.query(
                `SELECT recon_match_id FROM t_receipts WHERE source_txn_id = :txnId`,
                {
                    replacements: { txnId },
                    type: db.Sequelize.QueryTypes.SELECT,
                    transaction: t
                }
            );

            const reconIds = receipts
                .map(r => r.recon_match_id)
                .filter(id => id != null);

            // Step 1: Delete receipts
            await db.sequelize.query(
                `DELETE FROM t_receipts WHERE source_txn_id = :txnId`,
                {
                    replacements: { txnId },
                    type: db.Sequelize.QueryTypes.DELETE,
                    transaction: t
                }
            );

            // Step 2: Clear recon_match_id from linked records
            if (reconIds.length > 0) {
                await db.sequelize.query(
                    `UPDATE t_digital_sales SET recon_match_id = NULL WHERE recon_match_id IN (:reconIds)`,
                    {
                        replacements: { reconIds },
                        type: db.Sequelize.QueryTypes.UPDATE,
                        transaction: t
                    }
                );

                await db.sequelize.query(
                    `UPDATE t_adjustments SET recon_match_id = NULL WHERE recon_match_id IN (:reconIds)`,
                    {
                        replacements: { reconIds },
                        type: db.Sequelize.QueryTypes.UPDATE,
                        transaction: t
                    }
                );

                await db.sequelize.query(
                    `UPDATE t_receipts SET recon_match_id = NULL WHERE recon_match_id IN (:reconIds)`,
                    {
                        replacements: { reconIds },
                        type: db.Sequelize.QueryTypes.UPDATE,
                        transaction: t
                    }
                );
            }

            // Step 3: Log to audit trail BEFORE deleting
            await db.sequelize.query(
                `INSERT INTO t_bank_transaction_audit 
                 (t_bank_id, action_type, trans_date, remarks, credit_amount, debit_amount, 
                  bank_id, location_code, receipts_affected, recon_records_affected, 
                  performed_by, old_values)
                 VALUES (:txnId, 'DELETE', :transDate, :remarks, :creditAmount, :debitAmount,
                         :bankId, :locationCode, :receiptsAffected, :reconAffected,
                         :userName, :oldValues)`,
                {
                    replacements: {
                        txnId: transaction[0].t_bank_id,
                        transDate: transaction[0].trans_date,
                        remarks: transaction[0].remarks,
                        creditAmount: transaction[0].credit_amount,
                        debitAmount: transaction[0].debit_amount,
                        bankId: transaction[0].bank_id,
                        locationCode: transaction[0].location_code || 'SYSTEM',
                        receiptsAffected: receipts.length,
                        reconAffected: reconIds.length,
                        userName: userName,
                        oldValues: JSON.stringify(transaction[0])
                    },
                    type: db.Sequelize.QueryTypes.INSERT,
                    transaction: t
                }
            );

            // Step 4: Delete the bank transaction
            await db.sequelize.query(
                `DELETE FROM t_bank_transaction WHERE t_bank_id = :txnId`,
                {
                    replacements: { txnId },
                    type: db.Sequelize.QueryTypes.DELETE,
                    transaction: t
                }
            );

            await t.commit();
            return { success: true };

        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    /**
     * Get bank statement template for a bank account
     */
    getBankTemplate: async (bankId) => {
        const result = await db.sequelize.query(
            `SELECT t.* 
             FROM m_bank_statement_template t
             JOIN m_bank b ON t.bank_name = b.bank_name
             WHERE b.bank_id = :bankId 
               AND t.is_active = 1
             LIMIT 1`,
            {
                replacements: { bankId },
                type: db.Sequelize.QueryTypes.SELECT
            }
        );
        return result[0];
    },

    /**
     * Check for duplicate transactions
     */
 checkDuplicates: async (locationCode, bankId, transactions) => {
    if (!transactions || transactions.length === 0) {
        return [];
    }
    
    try {
        // Instead of building a giant OR query, we'll check in batches
        // This is much more efficient and avoids parameter substitution issues
        
        const batchSize = 50; // Check 50 transactions at a time
        let allDuplicates = [];
        
        for (let i = 0; i < transactions.length; i += batchSize) {
            const batch = transactions.slice(i, i + batchSize);
            
            // Build WHERE conditions for this batch
            const conditions = batch.map(() => 
                `(txn_date = ? AND credit_amount = ? AND debit_amount = ? AND description = ?)`
            ).join(' OR ');
            
            // Build replacements array
            const replacements = [];
            batch.forEach(t => {
                replacements.push(
                    t.txn_date,
                    parseFloat(t.credit_amount) || 0,
                    parseFloat(t.debit_amount) || 0,
                    t.description
                );
            });
            
            const query = `
                SELECT txn_date, description, credit_amount, debit_amount
                FROM t_bank_statement_actual
                WHERE location_code = ? 
                  AND bank_id = ?
                  AND (${conditions})
            `;
            
            // Add location and bank at the start of replacements
            const fullReplacements = [locationCode, bankId, ...replacements];
            
            const result = await db.sequelize.query(query, {
                replacements: fullReplacements,
                type: db.Sequelize.QueryTypes.SELECT
            });
            
            allDuplicates = allDuplicates.concat(result);
        }
        
        console.log(`checkDuplicates: Found ${allDuplicates.length} duplicates out of ${transactions.length} transactions`);
        return allDuplicates;
        
    } catch (error) {
        console.error('Error in checkDuplicates:', error);
        throw error;
    }
},






/**
 * Get the last (most recent) transaction date for a bank
 * Used for overlap validation to prevent missing transactions
 */
getLastTransactionDate: async (locationCode, bankId) => {
    const query = `
        SELECT MAX(trans_date) as last_date
        FROM t_bank_transaction
        WHERE bank_id = :bankId
    `;
    
    const result = await db.sequelize.query(query, {
        replacements: { bankId },
        type: db.Sequelize.QueryTypes.SELECT
    });
    
    // Return date in YYYY-MM-DD format or null if no transactions exist
    if (result[0]?.last_date) {
        const date = new Date(result[0].last_date);
        return date.toISOString().split('T')[0];
    }
    
    return null;
},



/**
 * Insert upload history record
 */
insertUploadHistory: async (historyData) => {
    try {
        const result = await db.sequelize.query(
            `INSERT INTO t_bank_statement_upload_history
             (location_code, bank_id, source_file, uploaded_by, 
              total_transactions, duplicates_found, transactions_imported,
              first_txn_date, last_txn_date, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            {
                replacements: [
                    historyData.location_code,
                    historyData.bank_id,
                    historyData.source_file,
                    historyData.uploaded_by,
                    historyData.total_transactions || 0,
                    historyData.duplicates_found || 0,
                    historyData.transactions_imported || 0,
                    historyData.first_txn_date || null,
                    historyData.last_txn_date || null,
                    historyData.status || 'COMPLETED',
                    historyData.remarks || null
                ],
                type: db.Sequelize.QueryTypes.INSERT
            }
        );
        console.log('Upload history inserted successfully:', result);
        return result;
    } catch (error) {
        console.error('Error inserting upload history:', error);
        throw error;
    }
},

/**
 * Get upload history for a location (optionally filtered by bank)
 */
getUploadHistory: async (locationCode, bankId = null, limit = 10) => {
    try {
        let query, replacements;
        
        if (bankId) {
            query = `
                SELECT 
                    h.upload_id,
                    h.source_file,
                    DATE_FORMAT(h.upload_date, '%d-%m-%Y %H:%i') as upload_date,
                    h.uploaded_by,
                    h.total_transactions,
                    h.duplicates_found,
                    h.transactions_imported,
                    DATE_FORMAT(h.first_txn_date, '%d-%m-%Y') as first_txn_date,
                    DATE_FORMAT(h.last_txn_date, '%d-%m-%Y') as last_txn_date,
                    h.status,
                    h.remarks,
                    b.bank_name,
                    b.account_nickname
                FROM t_bank_statement_upload_history h
                JOIN m_bank b ON h.bank_id = b.bank_id
                WHERE h.location_code = ? AND h.bank_id = ?
                ORDER BY h.upload_date DESC
                LIMIT ?
            `;
            replacements = [locationCode, bankId, limit];
        } else {
            query = `
                SELECT 
                    h.upload_id,
                    h.source_file,
                    DATE_FORMAT(h.upload_date, '%d-%m-%Y %H:%i') as upload_date,
                    h.uploaded_by,
                    h.total_transactions,
                    h.duplicates_found,
                    h.transactions_imported,
                    DATE_FORMAT(h.first_txn_date, '%d-%m-%Y') as first_txn_date,
                    DATE_FORMAT(h.last_txn_date, '%d-%m-%Y') as last_txn_date,
                    h.status,
                    h.remarks,
                    b.bank_name,
                    b.account_nickname
                FROM t_bank_statement_upload_history h
                JOIN m_bank b ON h.bank_id = b.bank_id
                WHERE h.location_code = ?
                ORDER BY h.upload_date DESC
                LIMIT ?
            `;
            replacements = [locationCode, limit];
        }
        
        const result = await db.sequelize.query(query, {
            replacements: replacements,
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        return result;
    } catch (error) {
        console.error('Error getting upload history:', error);
        throw error;
    }
},

    /**
     * Bulk insert bank statement transactions
     */

        bulkInsertStatements: async (locationCode, bankId, transactions, createdBy) => {
            const insertQuery = `
                INSERT INTO t_bank_statement_actual 
                (location_code,bank_id, txn_date, description, debit_amount, credit_amount, 
                balance_amount, statement_ref,source_file, created_by, creation_date)
                VALUES ?
            `;
            
            const values = transactions.map(txn => [
                locationCode,
                bankId,
                txn.txn_date,
                txn.description || '',
                parseFloat(txn.debit_amount) || 0,   // ← 0 instead of null
                parseFloat(txn.credit_amount) || 0,   // ← 0 instead of null
                txn.balance_amount || null,
                txn.statement_ref || null,
                txn.source_file || null,
                createdBy,
                new Date()
            ]);
            
            await db.sequelize.query(insertQuery, {
                replacements: [values],
                type: db.Sequelize.QueryTypes.INSERT
            });
            
            
            return { inserted: transactions.length };
        },
   

/**
 * Suggest ledger using adaptive pattern-based learning.
 *
 * The engine combines cached learning, phrase analysis, and structural
 * pattern recognition to intelligently suggest ledgers without hardcoding rules.
 *
 * Phase 1: Pattern Cache Lookup (Fast Path)
 *   - Generate a normalized pattern key from description.
 *   - If found in suggestion cache (recent & frequently used), return immediately.
 *
 * Phase 1A: Structural Pattern Fallback
 *   - If no meaningful textual pattern is extracted (e.g., numeric-only descriptions),
 *     generate a structural pattern by normalizing numeric sequences.
 *   - Enables learning of structured formats like reference IDs.
 *
 * Phase 2: Historical Phrase Matching
 *   - Extract meaningful words and phrases.
 *   - Match against historical transactions for the same bank and entry type.
 *   - Rank by phrase strength, usage frequency, and recency.
 *
 * Phase 2A: Structural Phrase Fallback
 *   - If no textual phrases are available, attempt structural matching.
 *
 * Phase 3: Continuous Learning
 *   - Once a user confirms a ledger, the pattern is cached.
 *   - Future similar descriptions are auto-mapped via cache.
 *
 * This design allows the system to:
 *   - Learn from user behavior
 *   - Generalize numeric structured patterns
 *   - Avoid hardcoded rules
 *   - Preserve backward compatibility with existing cache data
 */


getSuggestedLedger: async (bankId, description, entryType) => {

    const cleanDesc = description.toUpperCase().trim();

    // ============ PHASE 1: Check Learned Pattern Cache ============

    const extractPatternKey = (desc) => {
        let normalized = desc
            // Remove transaction prefixes and IDs
            .replace(/^(NEFT|IMPS|UPI|RTGS|IFT)[-\/][A-Z0-9]+[-\/]/gi, '')
            .replace(/[A-Z0-9]{10,}/gi, '')
            .replace(/[-\/\s]+/g, ' ')
            .trim();

        // Take first 3-4 meaningful words as pattern key
        const words = normalized.split(' ').filter(w =>
            w.length >= 3 && !/^\d+$/.test(w)
        ).slice(0, 4);

        return words.join(' ').substring(0, 200);
    };

    let patternKey = extractPatternKey(cleanDesc);

    // ================= SAFE STRUCTURAL FALLBACK =================
    // If no meaningful words extracted (numeric-only descriptions),
    // generate structural pattern instead of returning empty.
    if (!patternKey || patternKey.length === 0) {

        const structuralKey = cleanDesc
            // Replace long numbers with length-based token
            .replace(/\d{10,}/g, (match) => `NUM${match.length}`)
            // Replace remaining numbers
            .replace(/\d+/g, 'NUM')
            // Normalize separators
            .replace(/[-\/\s]+/g, ' ')
            .trim();

        if (structuralKey.length > 0) {
            patternKey = structuralKey.substring(0, 200);
            console.log(`[STRUCTURAL KEY GENERATED] ${cleanDesc} → ${patternKey}`);
        }
    }

    if (patternKey) {

        const cacheQuery = `
            SELECT 
                ledger_name,
                usage_count,
                last_used
            FROM t_bank_ledger_suggestion_cache
            WHERE bank_id = :bankId
                AND pattern_key = :patternKey
                AND (entry_type = :entryType OR entry_type = 'BOTH')
                AND last_used >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            ORDER BY usage_count DESC, last_used DESC
            LIMIT 1
        `;

        const cacheResult = await db.sequelize.query(cacheQuery, {
            replacements: { bankId, patternKey, entryType },
            type: db.Sequelize.QueryTypes.SELECT
        });

        if (cacheResult && cacheResult[0]) {
            console.log(`[CACHE HIT] Pattern: "${patternKey}" → ${cacheResult[0].ledger_name}`);
            return cacheResult[0];
        }
    }

    // ============ PHASE 2: Historical Pattern Matching ============

    let cleaned = cleanDesc
        .replace(/^(NEFT|IMPS|UPI|RTGS|IFT)[-\/][A-Z0-9]+[-\/]/gi, '')
        .replace(/-(YESB|SBIN|ICIC|HDFC|AXIS|PUNB|IDIB|IOBA|BARB|CBIN|CNRB|CORP|UBIN|VIJB)[A-Z0-9]*[-\/]/gi, '-')
        .replace(/[A-Z0-9]{10,}/gi, ' ');

    const words = cleaned.split(/[-\/\s]+/).filter(word =>
        word.length >= 2 &&
        !/^\d+$/.test(word) &&
        !/^[A-Z]{1}$/.test(word)
    );

    const phrases = [];
    for (let i = 0; i < words.length; i++) {
        if (words[i] && words[i].length >= 2) {
            if (words[i].length >= 3) {
                phrases.push(words[i]);
            }
            if (words[i + 1]) {
                phrases.push(`${words[i]} ${words[i + 1]}`);
                if (words[i + 2]) {
                    phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
                }
            }
        }
    }

    // ================= STRUCTURAL PHRASE FALLBACK =================
    // If still nothing extracted, try structural numeric phrases
    if (phrases.length === 0) {

        const structuralPhrase = cleanDesc
            .replace(/\d{10,}/g, (match) => `NUM${match.length}`)
            .replace(/\d+/g, 'NUM')
            .replace(/[-\/\s]+/g, ' ')
            .trim();

        if (structuralPhrase.length > 0) {
            phrases.push(structuralPhrase);
        }
    }

    if (phrases.length === 0) {
        return null;
    }

    const phraseConditions = phrases.map((_, idx) =>
        `UPPER(remarks) LIKE :phrase${idx}`
    ).join(' OR ');

    const phraseReplacements = { bankId, entryType };
    phrases.forEach((phrase, idx) => {
        phraseReplacements[`phrase${idx}`] = `%${phrase}%`;
    });

    const longestPhrase = phrases.sort((a, b) => b.length - a.length)[0];
    phraseReplacements.longestPhrase = longestPhrase;

    const historicalQuery = `
        SELECT 
            ledger_name,
            COUNT(*) as usage_count,
            MAX(trans_date) as last_used,
            LENGTH(:longestPhrase) as match_length
        FROM t_bank_transaction
        WHERE bank_id = :bankId
            AND ledger_name IS NOT NULL
            AND (${phraseConditions})
            AND (
                CASE 
                    WHEN :entryType = 'CREDIT' THEN credit_amount > 0
                    WHEN :entryType = 'DEBIT' THEN debit_amount > 0
                END
            )
            AND trans_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
        GROUP BY ledger_name
        ORDER BY match_length DESC, usage_count DESC, last_used DESC
        LIMIT 1
    `;

    const historicalResult = await db.sequelize.query(historicalQuery, {
        replacements: phraseReplacements,
        type: db.Sequelize.QueryTypes.SELECT
    });

    if (historicalResult && historicalResult[0]) {
        console.log(`[HISTORICAL MATCH] → ${historicalResult[0].ledger_name}`);
        return historicalResult[0];
    }

    return null;
},

/**
 * Learn from confirmed ledger selection (Adaptive Pattern Learning)
 *
 * Called after the user saves a transaction.
 * This method teaches the system how to auto-classify similar
 * descriptions in the future.
 *
 * Step 1: Generate a normalized pattern key from the description.
 *   - Removes transaction prefixes and long IDs.
 *   - Extracts meaningful words (text-based learning).
 *
 * Step 2: Structural Pattern Fallback (Numeric-Aware Learning).
 *   - If no meaningful words are found (e.g., numeric-only references),
 *     generate a structural pattern by normalizing numeric sequences
 *     (e.g., 4000530798-0000309 → NUM10-NUM7).
 *   - Enables learning of structured reference formats without hardcoding.
 *
 * Step 3: Upsert into cache table.
 *   - Inserts new pattern if not present.
 *   - Increments usage_count if pattern already exists.
 *   - Updates last_used timestamp.
 *
 * This design allows the system to:
 *   - Learn from user corrections
 *   - Support both text-based and numeric structured descriptions
 *   - Avoid hardcoded ledger mappings
 *   - Maintain backward compatibility with existing cache data
 *
 * NOTE:
 * Pattern extraction logic must remain consistent with
 * getSuggestedLedger() to ensure cache hits work correctly.
 */



learnFromSuggestion: async (bankId, description, ledgerName, entryType) => {

    const cleanDesc = description.toUpperCase().trim();

    const extractPatternKey = (desc) => {
        let normalized = desc
            .replace(/^(NEFT|IMPS|UPI|RTGS|IFT)[-\/][A-Z0-9]+[-\/]/gi, '')
            .replace(/[A-Z0-9]{10,}/gi, '')
            .replace(/[-\/\s]+/g, ' ')
            .trim();

        const words = normalized.split(' ').filter(w =>
            w.length >= 3 && !/^\d+$/.test(w)
        ).slice(0, 4);

        return words.join(' ').substring(0, 200);
    };

    let patternKey = extractPatternKey(cleanDesc);

    // ================= SAFE STRUCTURAL FALLBACK =================
    if (!patternKey || patternKey.length === 0) {

        const structuralKey = cleanDesc
            .replace(/\d{10,}/g, (match) => `NUM${match.length}`)
            .replace(/\d+/g, 'NUM')
            .replace(/[-\/\s]+/g, ' ')
            .trim();

        if (structuralKey.length > 0) {
            patternKey = structuralKey.substring(0, 200);
            console.log(`[STRUCTURAL LEARNING] ${cleanDesc} → ${patternKey}`);
        }
    }

    if (!patternKey) {
        return; // Still nothing meaningful
    }

    try {

        const learnQuery = `
            INSERT INTO t_bank_ledger_suggestion_cache 
                (bank_id, pattern_key, ledger_name, entry_type, usage_count, last_used)
            VALUES 
                (:bankId, :patternKey, :ledgerName, :entryType, 1, NOW())
            ON DUPLICATE KEY UPDATE
                usage_count = usage_count + 1,
                last_used = NOW(),
                ledger_name = :ledgerName
        `;

        await db.sequelize.query(learnQuery, {
            replacements: {
                bankId,
                patternKey,
                ledgerName,
                entryType
            },
            type: db.Sequelize.QueryTypes.INSERT
        });

        console.log(`[LEARNED] Pattern: "${patternKey}" → ${ledgerName} (${entryType})`);

    } catch (error) {
        console.error('Error learning pattern:', error);
        // Do not block main transaction save
    }
},




// checkStatementTransactionExists: async (bankId, locationCode, txnDate, creditAmount, debitAmount, balanceAmount) => {
//     const query = `
//         SELECT 
//             actual_stmt_id,
//             CASE WHEN balance_amount IS NOT NULL AND balance_amount != 0 THEN 1 ELSE 0 END as hasBalance
//         FROM t_bank_statement_actual
//         WHERE bank_id = :bankId
//           AND location_code = :locationCode
//           AND txn_date = :txnDate
//           AND COALESCE(credit_amount, 0) = :creditAmount
//           AND COALESCE(debit_amount, 0) = :debitAmount
//           ${balanceAmount ? 'AND balance_amount = :balanceAmount' : ''}
//         LIMIT 1
//     `;
    
//     const replacements = {
//         bankId,
//         locationCode,
//         txnDate,
//         creditAmount: parseFloat(creditAmount) || 0,
//         debitAmount: parseFloat(debitAmount) || 0
//     };
    
//     if (balanceAmount) {
//         replacements.balanceAmount = parseFloat(balanceAmount);
//     }
    
//     const result = await db.sequelize.query(query, {
//         replacements,
//         type: db.Sequelize.QueryTypes.SELECT
//     });
    
//     return {
//         exists: result.length > 0,
//         hasBalance: result.length > 0 && result[0].hasBalance === 1
//     };
// },

//removed balance check as SAP inserts statement above.
// code with balance check above is commented and can be reused later.
checkStatementTransactionExists: async (
    bankId,
    locationCode,
    txnDate,
    creditAmount,
    debitAmount,
    balanceAmount   // kept for compatibility, not used for matching
) => {

    const query = `
        SELECT 
            actual_stmt_id,
            balance_amount
        FROM t_bank_statement_actual
        WHERE bank_id = :bankId
          AND location_code = :locationCode
          AND txn_date = :txnDate
          AND ABS(COALESCE(credit_amount, 0) - :creditAmount) < 0.01
          AND ABS(COALESCE(debit_amount, 0) - :debitAmount) < 0.01
        LIMIT 1
    `;

    const replacements = {
        bankId,
        locationCode,
        txnDate,
        creditAmount: parseFloat(creditAmount) || 0,
        debitAmount: parseFloat(debitAmount) || 0
    };

    const result = await db.sequelize.query(query, {
        replacements,
        type: db.Sequelize.QueryTypes.SELECT
    });

    return {
        exists: result.length > 0,
        hasBalance: result.length > 0 && result[0].balance_amount !== null
    };
},


getLastStatementDate: async (locationCode, bankId) => {
    const query = `
        SELECT MAX(txn_date) as last_date
        FROM t_bank_statement_actual
        WHERE bank_id = :bankId
          AND location_code = :locationCode
    `;
    
    const result = await db.sequelize.query(query, {
        replacements: { bankId, locationCode },
        type: db.Sequelize.QueryTypes.SELECT
    });
    
    if (result[0]?.last_date) {
        const date = new Date(result[0].last_date);
        return date.toISOString().split('T')[0];
    }
    
    return null;
},

/**
 * Check if a specific transaction exists in the database
 * ENHANCED: Also checks running balance if available
 */
checkTransactionExists: async (bankId, transDate, creditAmount, debitAmount, runningBalance = null) => {
    let query = `
        SELECT 
            t_bank_id,
            running_balance
        FROM t_bank_transaction
        WHERE bank_id = :bankId
          AND trans_date = :transDate
          AND ABS(COALESCE(credit_amount, 0) - :creditAmount) < 0.01
          AND ABS(COALESCE(debit_amount, 0) - :debitAmount) < 0.01
    `;
    
    // If running balance is provided, add it as additional check
    // if (runningBalance !== null) {
    //     query += ` AND (
    //         running_balance IS NULL 
    //         OR ABS(COALESCE(running_balance, 0) - :runningBalance) < 0.01
    //     )`;
    // }
    
    query += ` LIMIT 1`;
    
    const result = await db.sequelize.query(query, {
        replacements: { 
            bankId, 
            transDate, 
            creditAmount: creditAmount || 0, 
            debitAmount: debitAmount || 0,
            runningBalance: runningBalance || 0
        },
        type: db.Sequelize.QueryTypes.SELECT
    });
    
    return {
        exists: result.length > 0,
        hasRunningBalance: result.length > 0 && result[0].running_balance !== null
    };
},
};