const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    // Get oil company bank accounts for a location
    getOilCompanyAccounts: async (locationCode) => {
        const query = `
            SELECT bank_id, bank_name, account_number, account_nickname, ledger_name
            FROM m_bank
            WHERE location_code = :locationCode
              AND is_oil_company = 'Y'
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

    
  // Get oil company transactions by date range and bank
    getTransactionsByDate: async (locationCode, fromDate, toDate, bankId) => {
        let query = `
            SELECT 
                tbt.t_bank_id,
                DATE_FORMAT(tbt.trans_date, '%d-%m-%Y') as trans_date,
                tbt.bank_id,
                tbt.remarks,
                tbt.credit_amount,
                tbt.debit_amount,
                tbt.ledger_name,
                tbt.closed_flag,
                tbt.closed_date,            
                mb.account_nickname,
                mb.bank_name
            FROM t_bank_transaction tbt
            JOIN m_bank mb ON tbt.bank_id = mb.bank_id
            WHERE mb.location_code = :locationCode
            AND mb.is_oil_company = 'Y'
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

    // Save transaction
    saveTransaction: async (transactionData) => {
        const query = `
            INSERT INTO t_bank_transaction (
                trans_date, bank_id, ledger_name,
                credit_amount, debit_amount, remarks, created_by
            ) VALUES (
                :trans_date, :bank_id, :ledger_name,
                :credit_amount, :debit_amount, :remarks, :created_by
            )
        `;
        
        return await db.sequelize.query(query, {
            replacements: transactionData,
            type: QueryTypes.INSERT
        });
    },

    // Get transaction by ID to check if it's closed
    getTransactionById: async (tBankId) => {
        const query = `
            SELECT 
                tbt.t_bank_id,
                tbt.trans_date,
                tbt.bank_id,            
                tbt.closed_flag,
                tbt.closed_date            
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

   
   
};