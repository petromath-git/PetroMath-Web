const db = require("../db/db-connection");
const Sequelize = require("sequelize");
const { QueryTypes } = Sequelize;

module.exports = {

    /**
     * Get cashflow bank deposits (outflows to bank)
     * These are the deposits recorded in day close
     */
    getCashflowBankDeposits: async (locationCode, fromDate, toDate) => {
        const query = `
            SELECT 
                DATE_FORMAT(tcc.cashflow_date, '%d-%m-%Y') as Date,
                tcc.cashflow_date as DateObj,
                tct.description as Description,
                tct.type as BankAccount,
                tct.amount as Amount,
                
                -- Source tracking
                't_cashflow_transaction' as source_table,
                tct.transaction_id as source_id,
                
                -- Reconciliation fields
                tct.recon_match_id,
                tct.manual_recon_flag,
                tct.manual_recon_by,
                tct.manual_recon_date,
                
                -- Additional metadata
                tcc.cashflow_id,
                ml.lookup_id
                
            FROM t_cashflow_transaction tct
            INNER JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
            LEFT JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' 
                AND ml.description = tct.type
                AND ml.location_code = tcc.location_code
            WHERE 
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND ml.tag = 'OUT'
                AND tct.type LIKE 'To Bank%'
                AND tct.amount > 0
            ORDER BY tcc.cashflow_date ASC
        `;

        return await db.sequelize.query(query, {
            replacements: { locationCode, fromDate, toDate },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get bank transaction credits (deposits received in bank)
     * These are the actual deposits shown in bank statement
     * Only from banks with internal_flag = 'Y'
     */
    getBankTransactionCredits: async (locationCode, fromDate, toDate, bankId = null) => {
        let query = `
            SELECT 
                DATE_FORMAT(tbt.trans_date, '%d-%m-%Y') as Date,
                tbt.trans_date as DateObj,
                COALESCE(mb.account_nickname, mb.account_number) as BankAccount,
                tbt.ledger_name as Description,
                tbt.credit_amount as Amount,
                tbt.remarks as Remarks,
                
                -- Source tracking
                't_bank_transaction' as source_table,
                tbt.t_bank_id as source_id,
                
                -- Reconciliation fields
                tbt.recon_match_id,
                tbt.manual_recon_flag,
                tbt.manual_recon_by,
                tbt.manual_recon_date,
                
                -- Additional metadata
                tbt.bank_id,
                mb.bank_name,
                tbt.closed_flag
                
            FROM t_bank_transaction tbt
            INNER JOIN m_bank mb ON tbt.bank_id = mb.bank_id
            INNER JOIN m_location ml ON mb.location_id = ml.location_id
            WHERE 
                ml.location_code = :locationCode
                AND DATE(tbt.trans_date) BETWEEN :fromDate AND :toDate
                AND tbt.credit_amount > 0
                AND tbt.credit_amount IS NOT NULL
                AND mb.internal_flag = 'Y'
                AND tbt.ledger_name LIKE '%CASH%'
        `;

        const replacements = { locationCode, fromDate, toDate };

        // Filter by specific bank if provided
        if (bankId && bankId !== '0' && bankId !== 0) {
            query += ` AND tbt.bank_id = :bankId`;
            replacements.bankId = bankId;
        }

        query += ` ORDER BY tbt.trans_date ASC`;

        return await db.sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get list of bank accounts for the location (only internal banks)
     */
    getBankAccountsList: async (locationCode) => {
        const query = `
            SELECT 
                mb.bank_id,
                mb.bank_name,
                mb.account_number,
                mb.account_nickname,
                COALESCE(mb.account_nickname, mb.account_number) as display_name
            FROM m_bank mb
            INNER JOIN m_location ml ON mb.location_id = ml.location_id
            WHERE ml.location_code = :locationCode
              AND mb.internal_flag = 'Y'
              AND mb.active_flag = 'Y'
            ORDER BY mb.account_nickname ASC
        `;

        return await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Update reconciliation match for cashflow transaction
     */
    updateCashflowReconMatch: async ({ recordId, matchId, user }) => {
        const query = `
            UPDATE t_cashflow_transaction
            SET 
                recon_match_id = :matchId,
                manual_recon_flag = 1,
                manual_recon_by = :user,
                manual_recon_date = NOW()
            WHERE transaction_id = :recordId
        `;

        return await db.sequelize.query(query, {
            replacements: { recordId, matchId, user },
            type: QueryTypes.UPDATE
        });
    },

    /**
     * Update reconciliation match for bank transaction
     */
    updateBankTxnReconMatch: async ({ recordId, matchId, user }) => {
        const query = `
            UPDATE t_bank_transaction
            SET 
                recon_match_id = :matchId,
                manual_recon_flag = 1,
                manual_recon_by = :user,
                manual_recon_date = NOW()
            WHERE t_bank_id = :recordId
        `;

        return await db.sequelize.query(query, {
            replacements: { recordId, matchId, user },
            type: QueryTypes.UPDATE
        });
    },

    /**
     * Clear reconciliation match (unmatch)
     */
    clearReconMatch: async ({ tableName, recordId }) => {
        const pkField = tableName === 't_cashflow_transaction' ? 'transaction_id' : 't_bank_id';
        
        const query = `
            UPDATE ${tableName}
            SET 
                recon_match_id = NULL,
                manual_recon_flag = 0,
                manual_recon_by = NULL,
                manual_recon_date = NULL
            WHERE ${pkField} = :recordId
        `;

        return await db.sequelize.query(query, {
            replacements: { recordId },
            type: QueryTypes.UPDATE
        });
    },

    /**
     * Get reconciliation status summary
     */
    getReconSummary: async (locationCode, fromDate, toDate, bankId = null) => {
        let query = `
            SELECT 
                'Cashflow Deposits' as source,
                COUNT(*) as total_count,
                SUM(tct.amount) as total_amount,
                SUM(CASE WHEN tct.recon_match_id IS NOT NULL THEN 1 ELSE 0 END) as matched_count,
                SUM(CASE WHEN tct.recon_match_id IS NOT NULL THEN tct.amount ELSE 0 END) as matched_amount
            FROM t_cashflow_transaction tct
            INNER JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
            LEFT JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' 
                AND ml.description = tct.type
                AND ml.location_code = tcc.location_code
            WHERE 
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND ml.tag = 'OUT'
                AND tct.type LIKE 'To Bank%'
                AND tct.amount > 0

            UNION ALL

            SELECT 
                'Bank Credits' as source,
                COUNT(*) as total_count,
                SUM(tbt.credit_amount) as total_amount,
                SUM(CASE WHEN tbt.recon_match_id IS NOT NULL THEN 1 ELSE 0 END) as matched_count,
                SUM(CASE WHEN tbt.recon_match_id IS NOT NULL THEN tbt.credit_amount ELSE 0 END) as matched_amount
            FROM t_bank_transaction tbt
            INNER JOIN m_bank mb ON tbt.bank_id = mb.bank_id
            INNER JOIN m_location ml ON mb.location_id = ml.location_id
            WHERE 
                ml.location_code = :locationCode
                AND DATE(tbt.trans_date) BETWEEN :fromDate AND :toDate
                AND tbt.credit_amount > 0
                AND tbt.credit_amount IS NOT NULL
        `;

        const replacements = { locationCode, fromDate, toDate };

        if (bankId && bankId !== '0' && bankId !== 0) {
            // This is a simplified approach - you may need to adjust based on your schema
            replacements.bankId = bankId;
        }

        return await db.sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });
    }
};