const db = require("../db/db-connection");
const Sequelize = db.Sequelize;

module.exports = {
    /**
     * Get list of internal banks for the location
     */
    getInternalBanks: async (locationCode) => {
        const result = await db.sequelize.query(
            `SELECT bank_id, bank_name, account_number, account_nickname
             FROM m_bank
             WHERE location_code = :locationCode
               AND internal_flag = 'Y'
             ORDER BY bank_name, account_nickname`,
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
    }
};