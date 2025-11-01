const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {

    

   getCashflowTrans: async (locationCode, cashhflowDate) => {
    const result = await db.sequelize.query(
        `SELECT tct.type,
                tct.description,
                IF(ml.tag = 'IN', tct.amount, '') credit,
                IF(ml.tag = 'OUT', tct.amount, '') debit
            FROM
                t_cashflow_transaction tct,
                t_cashflow_closing tcc,
                m_lookup ml
            WHERE
                tcc.location_code = :locationCode
                    AND DATE(tcc.cashflow_date) = :cashflowDate
                    AND tcc.cashflow_id = tct.cashflow_id
                    AND ml.lookup_type = 'CashFlow'
                    AND ml.description = tct.type
                    AND ml.location_code = tcc.location_code
                    AND tcc.closing_status = 'CLOSED'
            ORDER BY CONVERT( ml.attribute1 , SIGNED)`,
        {
          replacements: { locationCode: locationCode, cashflowDate: cashhflowDate },
          type: Sequelize.QueryTypes.SELECT
        }

    
      );

      return result;

   },

   getCashfowDenomination: async (locationCode, cashflowDate) => {
    const result = await db.sequelize.query(
        `select tct.denomination,tct.denomcount,tct.denomination*tct.denomcount amount
                                          from t_cashflow_denomination tct,t_cashflow_closing tcc
                                              where tcc.location_code = :locationCode
                                               and   DATE(tcc.cashflow_date) = :cashflowDate
                                               and tcc.cashflow_id = tct.cashflow_id`,
        {
          replacements: { locationCode: locationCode, cashflowDate: cashflowDate },
          type: Sequelize.QueryTypes.SELECT
        }

    
      );

      return result;

   },
   getBankAccounts: async (locationCode, cashflowDate) => {
    const result = await db.sequelize.query(`SELECT mb.account_nickname, mb.cc_limit,mb.bank_id
                                        FROM t_bank_transaction tbt, m_bank mb
                                        WHERE mb.bank_id = tbt.bank_id
                                        AND mb.location_code = :locationCode
                                        AND tbt.closed_flag = 'Y'
                                        AND DATE(tbt.closed_date) = :cashflowDate
                                        GROUP BY mb.account_nickname, mb.cc_limit,mb.bank_id`,
        {
          replacements: { locationCode: locationCode, cashflowDate: cashflowDate},
          type: Sequelize.QueryTypes.SELECT
        }

    
      );

      return result;

   },
   getBankTransaction: async (locationCode, cashflowDate) => {
    const result = await db.sequelize.query(`SELECT 
                                              COALESCE(mb.account_nickname, mb.account_number) AS bank_account,
                                              DATE_FORMAT(tbt.trans_date, '%d-%b-%Y') AS "Transaction Date",
                                              tbt.ledger_name AS "Ledger Name",
                                              COALESCE(tbt.credit_amount, 0) AS "Credit",
                                              COALESCE(tbt.debit_amount, 0) AS "Debit",
                                              tbt.remarks
                                          FROM 
                                              m_bank mb,
                                              t_bank_transaction tbt,
                                              m_location ml
                                          WHERE
                                              tbt.bank_id = mb.bank_id
                                              AND ml.location_id = mb.location_id
                                              AND ml.location_code = :locationCode
                                              AND DATE(tbt.closed_date) = :cashflowDate
                                          ORDER BY 
                                              tbt.t_bank_id, tbt.trans_date;`,
        {
          replacements: { locationCode: locationCode, cashflowDate: cashflowDate },
          type: Sequelize.QueryTypes.SELECT
        }

    
      );

      return result;

   },
}