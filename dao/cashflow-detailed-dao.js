const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    
    getCashflowDetailedData: async (fromDate, toDate, locationCode) => {
        const result = await db.sequelize.query(
            `SELECT
                DATE_FORMAT(tcc.cashflow_date, '%d/%m/%Y') as transaction_date,
                tct.description,
                tct.type as transaction_type,
                tct.entry_type as flow_type,
                CASE
                    WHEN tct.entry_type = 'CREDIT' THEN 'Inflow'
                    WHEN tct.entry_type = 'DEBIT' THEN 'Outflow'
                    ELSE tct.entry_type
                END as type,
                tct.type as category,
                tct.amount,
                tcc.cashflow_id as reference_no,
                tct.transaction_id,
                tct.calc_flag
            FROM
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
            WHERE
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND tct.amount > 0
            ORDER BY
                tcc.cashflow_date DESC,
                tct.entry_type DESC,
                tct.amount DESC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate,
                    toDate: toDate
                },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return result;
    },

    getCashflowDetailedSummary: async (fromDate, toDate, locationCode) => {
        const result = await db.sequelize.query(
            `SELECT
                COUNT(DISTINCT tct.transaction_id) as total_transactions,
                COALESCE(SUM(CASE WHEN tct.entry_type = 'CREDIT' THEN tct.amount ELSE 0 END), 0) as total_inflow,
                COALESCE(SUM(CASE WHEN tct.entry_type = 'DEBIT' THEN tct.amount ELSE 0 END), 0) as total_outflow,
                COALESCE(SUM(CASE
                    WHEN tct.entry_type = 'CREDIT' THEN tct.amount
                    WHEN tct.entry_type = 'DEBIT' THEN -tct.amount
                    ELSE 0
                END), 0) as net_cashflow
            FROM
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
            WHERE
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND tct.amount > 0`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate,
                    toDate: toDate
                },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return result[0];
    },

    getCashflowTypeWiseSummary: async (fromDate, toDate, locationCode) => {
        const result = await db.sequelize.query(
            `SELECT
                tct.type,
                tct.entry_type as tag,
                COUNT(*) as transaction_count,
                SUM(tct.amount) as total_amount
            FROM
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
            WHERE
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND tct.amount > 0
            GROUP BY
                tct.type, tct.entry_type
            ORDER BY
                tct.entry_type DESC, total_amount DESC`,
            {
                replacements: { 
                    locationCode: locationCode, 
                    fromDate: fromDate,
                    toDate: toDate
                },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return result;
    }
};