const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    // Get regular bank accounts for a location (NOT oil company banks)
    getBankAccounts: async (locationCode) => {
        const query = `
            SELECT bank_id, bank_name, account_number, account_nickname, ledger_name
            FROM m_bank
            WHERE location_code = :locationCode
              AND (is_oil_company IS NULL OR is_oil_company != 'Y')
            ORDER BY account_nickname
        `;
        
        return await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    // Get allowed ledgers for a specific bank account
    getAllowedLedgers: async (bankId, locationCode) => {
        const query = `
            SELECT
                rule_id,
                source_type,
                external_id,
                ledger_name,
                ledger_display_name,
                allowed_entry_type,
                notes_required_flag,
                max_amount,
                allow_split_flag
            FROM m_bank_allowed_ledgers_v
            WHERE bank_id = :bankId
              AND (location_code = :locationCode OR location_code IS NULL)
            ORDER BY source_type, ledger_display_name
        `;
        
        return await db.sequelize.query(query, {
            replacements: { bankId, locationCode },
            type: QueryTypes.SELECT
        });
    },

    getLedgerDetails: async (bankId, ledgerName, locationCode) => {
    const query = `
        SELECT 
            external_id,
            source_type
        FROM m_bank_allowed_ledgers_v
        WHERE bank_id = :bankId
          AND ledger_name = :ledgerName
          AND (location_code = :locationCode OR location_code IS NULL)
        LIMIT 1
    `;
    
    const result = await db.sequelize.query(query, {
        replacements: { bankId, ledgerName, locationCode },
        type: QueryTypes.SELECT
    });
    
    return result[0] || null;
},

    // Get bank transactions by date range and bank
    getTransactionsByDate: async (locationCode, fromDate, toDate, bankId) => {
        let query = `
            SELECT
                tbt.t_bank_id,
                DATE_FORMAT(tbt.trans_date, '%d-%m-%Y') as trans_date,
                tbt.bank_id,
                tbt.remarks,
                tbt.user_remark,
                tbt.credit_amount,
                tbt.debit_amount,
                tbt.ledger_name,
                tbt.closed_flag,
                tbt.closed_date,
                tbt.accounting_type,
                tbt.transaction_type,
                tbt.external_source,
                tbt.is_split,
                (SELECT COUNT(*) FROM t_bank_transaction_splits s WHERE s.t_bank_id = tbt.t_bank_id) AS split_count,
                mb.account_nickname,
                mb.bank_name
            FROM t_bank_transaction tbt
            JOIN m_bank mb ON tbt.bank_id = mb.bank_id
            WHERE mb.location_code = :locationCode
            AND (mb.is_oil_company IS NULL OR mb.is_oil_company != 'Y')
            AND tbt.trans_date BETWEEN :fromDate AND :toDate
        `;

        const replacements = { locationCode, fromDate, toDate };

        if (bankId && bankId != 0) {
            query += ' AND tbt.bank_id = :bankId';
            replacements.bankId = bankId;
        }

        // Sort: closed records first (by date ASC), then open records at end
        query += ' ORDER BY CASE WHEN tbt.closed_flag = "Y" THEN 0 ELSE 1 END, tbt.trans_date ASC, tbt.t_bank_id ASC';

        return await db.sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });
    },

    // Get location ID
    getLocationId: async (locationCode) => {
        const query = `
            SELECT location_id
            FROM m_location
            WHERE location_code = :locationCode
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
        
        return result[0];
    },

 

//   saveTransaction: async (transactionData) => {
//     const query = `
//         INSERT INTO t_bank_transaction (
//             trans_date, bank_id, ledger_name,
//             credit_amount, debit_amount, remarks,
//             external_id, external_source, 
//             running_balance,
//             created_by
//         ) VALUES (
//             :trans_date, :bank_id, :ledger_name,
//             :credit_amount, :debit_amount, :remarks,
//             :external_id, :external_source,
//             :running_balance,
//             :created_by
//         )
//     `;
    
//     return await db.sequelize.query(query, {
//         replacements: transactionData,
//         type: QueryTypes.INSERT
//     });
// },

saveTransaction: async (transactionData) => {

    const t = await db.sequelize.transaction();

    try {

        // 1️⃣ Insert bank transaction
        const insertQuery = `
            INSERT INTO t_bank_transaction (
                trans_date,
                bank_id,
                ledger_name,
                credit_amount,
                debit_amount,
                remarks,
                user_remark,
                external_id,
                external_source,
                running_balance,
                closed_flag,
                closed_date,
                created_by,
                creation_date
            ) VALUES (
                :trans_date,
                :bank_id,
                :ledger_name,
                :credit_amount,
                :debit_amount,
                :remarks,
                :user_remark,
                :external_id,
                :external_source,
                :running_balance,
                'Y',
                CURDATE(),
                :created_by,
                NOW()
            )
        `;

        const result = await db.sequelize.query(insertQuery, {
            replacements: transactionData,
            type: QueryTypes.INSERT,
            transaction: t
        });

        const insertedId = result[0]; // t_bank_id


        // 2️⃣ Auto-create receipt (ONLY for CREDIT deposits)
        if (
            transactionData.external_source &&
            transactionData.external_source.toUpperCase() === 'CREDIT' &&
            parseFloat(transactionData.credit_amount) > 0 &&
            transactionData.external_id
        ) {

            // Get location_code from m_bank
            const bankInfo = await db.sequelize.query(
                `SELECT location_code 
                 FROM m_bank 
                 WHERE bank_id = :bankId`,
                {
                    replacements: { bankId: transactionData.bank_id },
                    type: QueryTypes.SELECT,
                    transaction: t
                }
            );

            const locationCode = bankInfo[0]?.location_code;

            // Get next receipt number
            const receiptMax = await db.sequelize.query(
                `SELECT COALESCE(MAX(receipt_no),0) as max_no
                 FROM t_receipts
                 WHERE location_code = :locationCode`,
                {
                    replacements: { locationCode },
                    type: QueryTypes.SELECT,
                    transaction: t
                }
            );

            const nextReceiptNo = parseInt(receiptMax[0].max_no) + 1;

            await db.sequelize.query(
                `INSERT INTO t_receipts (
                    receipt_no,
                    creditlist_id,
                    amount,
                    receipt_date,
                    receipt_type,
                    location_code,
                    cashflow_date,
                    notes,
                    created_by,
                    updated_by,
                    creation_date,
                    updation_date,
                    source_txn_id
                ) VALUES (
                    :receipt_no,
                    :creditlist_id,
                    :amount,
                    :receipt_date,
                    'Bank Deposit',
                    :location_code,
                    CURDATE(),
                    :notes,
                    :created_by,
                    :created_by,
                    NOW(),
                    NOW(),
                    :source_txn_id
                )`,
                {
                    replacements: {
                        receipt_no: nextReceiptNo,
                        creditlist_id: transactionData.external_id,
                        amount: transactionData.credit_amount,
                        receipt_date: transactionData.trans_date,
                        location_code: locationCode,
                        created_by: transactionData.created_by,
                        source_txn_id: insertedId,
                        notes: transactionData.remarks
                            ? `Auto from Bank - ${transactionData.remarks}`
                            : 'Auto from Bank'
                    },
                    type: QueryTypes.INSERT,
                    transaction: t
                }
            );
        }

        await t.commit();
        return result;

    } catch (error) {
        await t.rollback();
        throw error;
    }
},



    // Get transaction by ID to check if it's closed
    getTransactionById: async (tBankId) => {
        const query = `
            SELECT
                tbt.t_bank_id,
                tbt.trans_date,
                tbt.bank_id,
                tbt.closed_flag,
                tbt.closed_date,
                tbt.external_source,
                tbt.credit_amount,
                tbt.debit_amount,
                tbt.remarks,
                tbt.is_split
            FROM t_bank_transaction tbt
            WHERE tbt.t_bank_id = :tBankId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { tBankId },
            type: QueryTypes.SELECT
        });

        return result[0];
    },

    // Delete transaction — also cleans up splits and their auto-receipts when is_split = 'Y'
    deleteTransaction: async (tBankId) => {
        const t = await db.sequelize.transaction();
        try {
            // Delete receipts linked to this transaction (covers both direct and split-created receipts)
            await db.sequelize.query(
                `DELETE FROM t_receipts WHERE source_txn_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            // Splits are removed by ON DELETE CASCADE on the FK, but explicit delete
            // here keeps the intent clear and guards against engines without FK enforcement.
            await db.sequelize.query(
                `DELETE FROM t_bank_transaction_splits WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            await db.sequelize.query(
                `DELETE FROM t_bank_transaction WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    // Get transaction types (from lookup table)
    getTransactionTypes: async () => {
        const query = `
            SELECT lookup_id, description, attribute1
            FROM m_lookup
            WHERE lookup_type = 'Bank_Transaction_Type'
            ORDER BY description
        `;
        
        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
    },

    // Reclassify an existing transaction's ledger.
    // If reclassifying to a Credit ledger on a credit transaction, auto-creates
    // a receipt in t_receipts (mirrors the saveTransaction receipt logic).
    reclassifyTransaction: async ({ t_bank_id, ledger_name, external_id, external_source,
                                    create_receipt, location_code, receipt_date, credit_amount, created_by }) => {
        const t = await db.sequelize.transaction();
        try {
            await db.sequelize.query(
                `UPDATE t_bank_transaction
                 SET ledger_name     = :ledger_name,
                     external_id     = :external_id,
                     external_source = :external_source
                 WHERE t_bank_id = :t_bank_id`,
                { replacements: { t_bank_id, ledger_name, external_id, external_source }, type: QueryTypes.UPDATE, transaction: t }
            );

            if (create_receipt && external_id && parseFloat(credit_amount) > 0) {
                const receiptMax = await db.sequelize.query(
                    `SELECT COALESCE(MAX(receipt_no), 0) AS max_no FROM t_receipts WHERE location_code = :location_code`,
                    { replacements: { location_code }, type: QueryTypes.SELECT, transaction: t }
                );
                const nextReceiptNo = parseInt(receiptMax[0].max_no) + 1;

                await db.sequelize.query(
                    `INSERT INTO t_receipts (
                        receipt_no, creditlist_id, amount, receipt_date, receipt_type,
                        location_code, cashflow_date, notes,
                        created_by, updated_by, creation_date, updation_date, source_txn_id
                     ) VALUES (
                        :receipt_no, :creditlist_id, :amount, :receipt_date, 'Bank Deposit',
                        :location_code, CURDATE(), 'Reclassified from Bank',
                        :created_by, :created_by, NOW(), NOW(), :source_txn_id
                     )`,
                    {
                        replacements: {
                            receipt_no: nextReceiptNo,
                            creditlist_id: external_id,
                            amount: credit_amount,
                            receipt_date,
                            location_code,
                            created_by,
                            source_txn_id: t_bank_id
                        },
                        type: QueryTypes.INSERT,
                        transaction: t
                    }
                );
            }

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    bulkReclassifyTransactions: async (updates) => {
        const t = await db.sequelize.transaction();
        try {
            for (const upd of updates) {
                await db.sequelize.query(
                    `UPDATE t_bank_transaction
                     SET ledger_name     = :ledger_name,
                         external_id     = :external_id,
                         external_source = :external_source
                     WHERE t_bank_id = :t_bank_id`,
                    { replacements: { t_bank_id: upd.t_bank_id, ledger_name: upd.ledger_name, external_id: upd.external_id, external_source: upd.external_source }, type: QueryTypes.UPDATE, transaction: t }
                );

                if (upd.create_receipt && upd.external_id && parseFloat(upd.credit_amount) > 0) {
                    const receiptMax = await db.sequelize.query(
                        `SELECT COALESCE(MAX(receipt_no), 0) AS max_no FROM t_receipts WHERE location_code = :location_code`,
                        { replacements: { location_code: upd.location_code }, type: QueryTypes.SELECT, transaction: t }
                    );
                    const nextReceiptNo = parseInt(receiptMax[0].max_no) + 1;

                    await db.sequelize.query(
                        `INSERT INTO t_receipts (
                            receipt_no, creditlist_id, amount, receipt_date, receipt_type,
                            location_code, cashflow_date, notes,
                            created_by, updated_by, creation_date, updation_date, source_txn_id
                         ) VALUES (
                            :receipt_no, :creditlist_id, :amount, :receipt_date, 'Bank Deposit',
                            :location_code, CURDATE(), 'Reclassified from Bank',
                            :created_by, :created_by, NOW(), NOW(), :source_txn_id
                         )`,
                        {
                            replacements: {
                                receipt_no: nextReceiptNo,
                                creditlist_id: upd.external_id,
                                amount: upd.credit_amount,
                                receipt_date: upd.receipt_date,
                                location_code: upd.location_code,
                                created_by: upd.created_by,
                                source_txn_id: upd.t_bank_id
                            },
                            type: QueryTypes.INSERT,
                            transaction: t
                        }
                    );
                }
            }

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    // Get accounting types
    getAccountingTypes: async () => {
        const query = `
            SELECT DISTINCT attribute1 as accounting_type
            FROM m_lookup
            WHERE lookup_type = 'Bank_Transaction_Type'
            AND attribute1 IS NOT NULL
            ORDER BY attribute1
        `;

        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
    },

    // ── Split transaction support ─────────────────────────────────────────────

    // Get ledgers eligible to be used in a split (allow_split_flag = 'Y').
    // The entry_type param ('CREDIT' or 'DEBIT') narrows to relevant direction.
    getSplitEligibleLedgers: async (bankId, locationCode, entryType) => {
        const query = `
            SELECT
                rule_id,
                source_type,
                external_id,
                ledger_name,
                ledger_display_name,
                allowed_entry_type,
                notes_required_flag,
                max_amount
            FROM m_bank_allowed_ledgers_v
            WHERE bank_id        = :bankId
              AND (location_code = :locationCode OR location_code IS NULL)
              AND allow_split_flag = 'Y'
              AND (allowed_entry_type = 'BOTH' OR allowed_entry_type = :entryType)
            ORDER BY source_type, ledger_display_name
        `;
        return await db.sequelize.query(query, {
            replacements: { bankId, locationCode, entryType },
            type: QueryTypes.SELECT
        });
    },

    // Fetch existing splits for a transaction.
    getSplitsForTransaction: async (tBankId) => {
        const query = `
            SELECT
                split_id,
                t_bank_id,
                amount,
                ledger_name,
                external_id,
                external_source,
                remarks,
                created_by,
                creation_date
            FROM t_bank_transaction_splits
            WHERE t_bank_id = :tBankId
            ORDER BY split_id
        `;
        return await db.sequelize.query(query, {
            replacements: { tBankId },
            type: QueryTypes.SELECT
        });
    },

    // Save splits for a transaction.
    //   splits: [{ ledger_name, external_id, external_source, amount, remarks }]
    //
    //   Validates:
    //     • each ledger has allow_split_flag = 'Y'
    //     • split amounts sum to the parent's credit/debit amount
    //
    //   Receipt creation strategy mirrors the existing non-split pattern:
    //     • Non-cashflow location: receipts created immediately here (same as
    //       saveTransaction does for manually-entered Credit transactions).
    //       source_split_id is set for precise per-split dedup.
    //     • Cashflow-enabled location: receipts are NOT created here.
    //       The after_cashflow_close trigger creates them at cashflow close,
    //       reading from t_bank_transaction_splits. parent closed_flag stays 'N'
    //       so the trigger's bulk UPDATE closes it alongside everything else.
    saveSplits: async (tBankId, splits, bankId, locationCode, createdBy) => {
        if (!Array.isArray(splits) || splits.length === 0) {
            throw new Error('At least one split allocation is required.');
        }

        const t = await db.sequelize.transaction();
        try {
            // Fetch parent
            const [parent] = await db.sequelize.query(
                `SELECT t_bank_id, credit_amount, debit_amount, trans_date, bank_id
                 FROM t_bank_transaction WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.SELECT, transaction: t }
            );
            if (!parent) throw new Error(`Transaction ${tBankId} not found.`);

            const parentAmount = parseFloat(parent.credit_amount || parent.debit_amount || 0);
            const splitTotal   = splits.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

            if (Math.abs(splitTotal - parentAmount) > 0.01) {
                throw new Error(
                    `Split total ${splitTotal.toFixed(2)} does not match transaction amount ${parentAmount.toFixed(2)}.`
                );
            }

            // Validate each ledger is split-eligible
            for (const split of splits) {
                const [eligible] = await db.sequelize.query(
                    `SELECT allow_split_flag
                     FROM m_bank_allowed_ledgers_v
                     WHERE bank_id        = :bankId
                       AND (location_code = :locationCode OR location_code IS NULL)
                       AND external_id   = :externalId
                       AND allow_split_flag = 'Y'
                     LIMIT 1`,
                    {
                        replacements: { bankId, locationCode, externalId: split.external_id },
                        type: QueryTypes.SELECT,
                        transaction: t
                    }
                );
                if (!eligible) {
                    throw new Error(`Ledger "${split.ledger_name}" is not eligible for split allocation.`);
                }
            }

            // Check whether this location uses cashflow
            const [cfRow] = await db.sequelize.query(
                `SELECT setting_value
                 FROM m_location_config
                 WHERE (location_code = :locationCode OR location_code = '*')
                   AND setting_name = 'CASHFLOW_ENABLED'
                 ORDER BY CASE WHEN location_code = :locationCode THEN 0 ELSE 1 END
                 LIMIT 1`,
                { replacements: { locationCode }, type: QueryTypes.SELECT, transaction: t }
            );
            const cashflowEnabled = !cfRow || String(cfRow.setting_value).toLowerCase() !== 'false';

            // Remove the original receipt created at upload time (source_split_id IS NULL),
            // as well as any receipts from a prior re-split (source_split_id IS NOT NULL).
            // This prevents double-counting when the full-amount receipt coexists with split receipts.
            await db.sequelize.query(
                `DELETE FROM t_receipts WHERE source_txn_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );
            await db.sequelize.query(
                `DELETE FROM t_bank_transaction_splits WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            // Insert each split row; for non-cashflow Credit splits, create receipt immediately
            for (const split of splits) {
                const [splitInsertResult] = await db.sequelize.query(
                    `INSERT INTO t_bank_transaction_splits
                        (t_bank_id, amount, ledger_name, external_id, external_source, remarks, created_by, creation_date)
                     VALUES
                        (:tBankId, :amount, :ledger_name, :external_id, :external_source, :remarks, :createdBy, NOW())`,
                    {
                        replacements: {
                            tBankId,
                            amount:          split.amount,
                            ledger_name:     split.ledger_name,
                            external_id:     split.external_id    || null,
                            external_source: split.external_source || null,
                            remarks:         split.remarks         || null,
                            createdBy
                        },
                        type: QueryTypes.INSERT,
                        transaction: t
                    }
                );
                const splitId = splitInsertResult; // LAST_INSERT_ID

                // Non-cashflow only: create receipt immediately (same as saveTransaction)
                if (
                    !cashflowEnabled &&
                    split.external_source &&
                    split.external_source.toUpperCase() === 'CREDIT' &&
                    parseFloat(split.amount) > 0 &&
                    split.external_id
                ) {
                    const [receiptMax] = await db.sequelize.query(
                        `SELECT COALESCE(MAX(receipt_no), 0) AS max_no
                         FROM t_receipts WHERE location_code = :locationCode`,
                        { replacements: { locationCode }, type: QueryTypes.SELECT, transaction: t }
                    );
                    const nextReceiptNo = parseInt(receiptMax.max_no) + 1;

                    await db.sequelize.query(
                        `INSERT INTO t_receipts (
                            receipt_no, creditlist_id, amount, receipt_date, receipt_type,
                            location_code, cashflow_date, notes,
                            created_by, updated_by, creation_date, updation_date,
                            source_txn_id, source_split_id
                         ) VALUES (
                            :receipt_no, :creditlist_id, :amount, :receipt_date, 'Bank Deposit',
                            :location_code, CURDATE(), :notes,
                            :created_by, :created_by, NOW(), NOW(),
                            :source_txn_id, :source_split_id
                         )`,
                        {
                            replacements: {
                                receipt_no:      nextReceiptNo,
                                creditlist_id:   split.external_id,
                                amount:          split.amount,
                                receipt_date:    parent.trans_date,
                                location_code:   locationCode,
                                notes:           split.remarks
                                                     ? `Split from Bank - ${split.remarks}`
                                                     : 'Split from Bank',
                                created_by:      createdBy,
                                source_txn_id:   tBankId,
                                source_split_id: splitId
                            },
                            type: QueryTypes.INSERT,
                            transaction: t
                        }
                    );
                }
            }

            // Mark parent as split.
            // For cashflow locations: leave closed_flag = 'N' — the trigger closes it.
            // For non-cashflow locations: close it now (no trigger will run).
            if (cashflowEnabled) {
                // Explicitly reset closed_flag — parent may have been inserted as 'Y'
                // (e.g. split applied at upload time). Trigger needs 'N' to process it.
                await db.sequelize.query(
                    `UPDATE t_bank_transaction
                     SET is_split = 'Y', closed_flag = 'N', closed_date = NULL
                     WHERE t_bank_id = :tBankId`,
                    { replacements: { tBankId }, type: QueryTypes.UPDATE, transaction: t }
                );
            } else {
                await db.sequelize.query(
                    `UPDATE t_bank_transaction
                     SET is_split = 'Y', closed_flag = 'Y', closed_date = CURDATE()
                     WHERE t_bank_id = :tBankId`,
                    { replacements: { tBankId }, type: QueryTypes.UPDATE, transaction: t }
                );
            }

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },

    // Remove all splits for a transaction and reset it to unclassified.
    // Deletes only receipts that carry a source_split_id (i.e. created by saveSplits
    // for non-cashflow locations). For cashflow locations the trigger creates receipts
    // at cashflow close; those will have source_split_id set too, so they are removed
    // here as well — callers should guard against deleting splits after cashflow close.
    deleteSplits: async (tBankId) => {
        const t = await db.sequelize.transaction();
        try {
            // Remove only split-created receipts (identified by source_split_id)
            await db.sequelize.query(
                `DELETE FROM t_receipts
                 WHERE source_split_id IN (
                     SELECT split_id FROM t_bank_transaction_splits WHERE t_bank_id = :tBankId
                 )`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            await db.sequelize.query(
                `DELETE FROM t_bank_transaction_splits WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.DELETE, transaction: t }
            );

            // Revert parent to unclassified / unsplit state
            await db.sequelize.query(
                `UPDATE t_bank_transaction
                 SET is_split        = 'N',
                     closed_flag     = 'N',
                     closed_date     = NULL,
                     ledger_name     = NULL,
                     external_id     = NULL,
                     external_source = NULL
                 WHERE t_bank_id = :tBankId`,
                { replacements: { tBankId }, type: QueryTypes.UPDATE, transaction: t }
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }
};