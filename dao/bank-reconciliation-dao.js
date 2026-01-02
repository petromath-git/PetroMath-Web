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
             ORDER BY bt.trans_date, bt.t_bank_id`,
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
             ORDER BY a.txn_date, a.actual_stmt_id`,
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
    }
};