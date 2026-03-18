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
                max_amount
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
                tbt.remarks
            FROM t_bank_transaction tbt
            WHERE tbt.t_bank_id = :tBankId
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { tBankId },
            type: QueryTypes.SELECT
        });
        
        return result[0];
    },

    // Delete transaction
    deleteTransaction: async (tBankId) => {
        const query = `
            DELETE FROM t_bank_transaction
            WHERE t_bank_id = :tBankId
        `;
        
        return await db.sequelize.query(query, {
            replacements: { tBankId },
            type: QueryTypes.DELETE
        });
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
    }
};