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
                ml.tag as flow_type,
                CASE 
                    WHEN ml.tag = 'IN' THEN 'Inflow'
                    WHEN ml.tag = 'OUT' THEN 'Outflow'
                    ELSE ml.tag
                END as type,
                IFNULL(ml.attribute5, tct.type) as category,
                tct.amount,
                tcc.cashflow_id as reference_no,
                tct.transaction_id,
                tct.calc_flag
            FROM 
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
                LEFT JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' 
                    AND ml.description = tct.type 
                    AND ml.location_code = tcc.location_code
            WHERE 
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND tct.amount > 0
            ORDER BY 
                tcc.cashflow_date DESC, 
                ml.tag DESC, 
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
                COALESCE(SUM(CASE WHEN ml.tag = 'IN' THEN tct.amount ELSE 0 END), 0) as total_inflow,
                COALESCE(SUM(CASE WHEN ml.tag = 'OUT' THEN tct.amount ELSE 0 END), 0) as total_outflow,
                COALESCE(SUM(CASE 
                    WHEN ml.tag = 'IN' THEN tct.amount
                    WHEN ml.tag = 'OUT' THEN -tct.amount
                    ELSE 0 
                END), 0) as net_cashflow
            FROM 
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
                LEFT JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' 
                    AND ml.description = tct.type 
                    AND ml.location_code = tcc.location_code
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
                ml.tag,
                COUNT(*) as transaction_count,
                SUM(tct.amount) as total_amount
            FROM 
                t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tct.cashflow_id = tcc.cashflow_id
                LEFT JOIN m_lookup ml ON ml.lookup_type = 'CashFlow' 
                    AND ml.description = tct.type 
                    AND ml.location_code = tcc.location_code
            WHERE 
                tcc.location_code = :locationCode
                AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
                AND tcc.closing_status = 'CLOSED'
                AND tct.amount > 0
            GROUP BY 
                tct.type, ml.tag
            ORDER BY 
                ml.tag DESC, total_amount DESC`,
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