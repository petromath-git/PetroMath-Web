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
        // Build a query to check for existing transactions
        const dateAmountPairs = transactions.map(t => 
            `(txn_date = '${t.txn_date}' AND 
              ((credit_amount = ${t.credit_amount || 0} AND debit_amount = ${t.debit_amount || 0}) OR
               description = '${t.description.replace(/'/g, "''")}'))`
        ).join(' OR ');

        if (!dateAmountPairs) return [];

        const result = await db.sequelize.query(
            `SELECT txn_date, description, credit_amount, debit_amount
             FROM t_bank_statement_actual
             WHERE location_code = :locationCode
               AND bank_id = :bankId
               AND (${dateAmountPairs})`,
            {
                replacements: { locationCode, bankId },
                type: db.Sequelize.QueryTypes.SELECT
            }
        );
        return result;
    },

    /**
     * Bulk insert bank statement transactions
     */
    bulkInsertStatements: async (locationCode, bankId, transactions, userName) => {
        const t = await db.sequelize.transaction();

        try {
            for (const txn of transactions) {
                await db.sequelize.query(
                    `INSERT INTO t_bank_statement_actual
                     (location_code, bank_id, txn_date, description, debit_amount, credit_amount, 
                      balance_amount, statement_ref, source_file, created_by, creation_date)
                     VALUES (:locationCode, :bankId, :txnDate, :description, :debit, :credit,
                             :balance, :ref, :sourceFile, :createdBy, NOW())`,
                    {
                        replacements: {
                            locationCode: locationCode,
                            bankId: bankId,
                            txnDate: txn.txn_date,
                            description: txn.description,
                            debit: txn.debit_amount || 0,
                            credit: txn.credit_amount || 0,
                            balance: txn.balance_amount || 0,
                            ref: txn.statement_ref || null,
                            sourceFile: txn.source_file || null,
                            createdBy: userName
                        },
                        type: db.Sequelize.QueryTypes.INSERT,
                        transaction: t
                    }
                );
            }

            await t.commit();
            return { success: true, inserted: transactions.length };

        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    /**
 * Suggest ledger based on historical transactions with similar descriptions
 */
/**
 * Suggest ledger using pure machine learning approach
 * Phase 1: Check learned pattern cache (fast)
 * Phase 2: Extract phrases and match historical data
 * Phase 3: Learn from this suggestion for next time
 */
getSuggestedLedger: async (bankId, description, entryType) => {
    const cleanDesc = description.toUpperCase().trim();
    
    // ============ PHASE 1: Check Learned Pattern Cache ============
    // This is like "muscle memory" - patterns we've successfully used before
    
    // Extract a normalized pattern key from description
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
    
    const patternKey = extractPatternKey(cleanDesc);
    
    if (patternKey) {
        // Quick cache lookup
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
    // Learn from raw transaction history
    
    // Clean and extract phrases
    let cleaned = cleanDesc
        .replace(/^(NEFT|IMPS|UPI|RTGS|IFT)[-\/][A-Z0-9]+[-\/]/gi, '')
        .replace(/-(YESB|SBIN|ICIC|HDFC|AXIS|PUNB|IDIB|IOBA|BARB|CBIN|CNRB|CORP|UBIN|VIJB)[A-Z0-9]*[-\/]/gi, '-')
        .replace(/[A-Z0-9]{10,}/gi, ' ');
    
    const words = cleaned.split(/[-\/\s]+/).filter(word => 
        word.length >= 2 && 
        !/^\d+$/.test(word) && 
        !/^[A-Z]{1}$/.test(word)
    );
    
    // Build phrases
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
    
    if (phrases.length === 0) {
        return null; // Can't extract anything meaningful
    }
    
    // Build dynamic query from extracted phrases
    const phraseConditions = phrases.map((_, idx) => 
        `UPPER(remarks) LIKE :phrase${idx}`
    ).join(' OR ');
    
    const phraseReplacements = { bankId, entryType };
    phrases.forEach((phrase, idx) => {
        phraseReplacements[`phrase${idx}`] = `%${phrase}%`;
    });
    
    const historicalQuery = `
        SELECT 
            ledger_name,
            COUNT(*) as usage_count,
            MAX(trans_date) as last_used,
            MAX(LENGTH(:longestPhrase)) as match_length
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
    
    phraseReplacements.longestPhrase = phrases.sort((a, b) => b.length - a.length)[0];
    
    const historicalResult = await db.sequelize.query(historicalQuery, {
        replacements: phraseReplacements,
        type: db.Sequelize.QueryTypes.SELECT
    });
    
    if (historicalResult && historicalResult[0]) {
        console.log(`[HISTORICAL MATCH] Phrases: ${phrases.slice(0, 3).join(', ')} → ${historicalResult[0].ledger_name}`);
        return historicalResult[0];
    }
    
    return null;
},

/**
 * Learn from successful suggestion - called after user saves entry
 * This teaches the system for next time
 */
learnFromSuggestion: async (bankId, description, ledgerName, entryType) => {
    const cleanDesc = description.toUpperCase().trim();
    
    // Extract pattern key (same logic as getSuggestedLedger)
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
    
    const patternKey = extractPatternKey(cleanDesc);
    
    if (!patternKey) {
        return; // Can't learn from this pattern
    }
    
    try {
        // Insert or update the cache
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
        // Don't fail the main operation if learning fails
    }
}
};