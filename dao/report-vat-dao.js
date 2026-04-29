const db = require("../db/db-connection");
const Sequelize = require("sequelize");

module.exports = {

    getChargeTypes: async (locationCode, reportFromDate, reportToDate) => {
        const result = await db.sequelize.query(
            `SELECT DISTINCT tic.charge_type
             FROM t_tank_invoice ti
             JOIN t_tank_invoice_dtl tid ON ti.id = tid.invoice_id
             JOIN m_product mp ON tid.product_id = mp.product_id
             JOIN t_tank_invoice_charges tic ON tid.id = tic.invoice_dtl_id
             WHERE ti.location_id = :locationCode
               AND ti.invoice_date BETWEEN :reportFromDate AND :reportToDate
               AND COALESCE(mp.is_lube_product, 0) = 0
             ORDER BY tic.charge_type`,
            {
                replacements: { locationCode, reportFromDate, reportToDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result.map(r => r.charge_type);
    },

    getVatDetail: async (locationCode, reportFromDate, reportToDate) => {
        const result = await db.sequelize.query(
            `SELECT
                COALESCE(ms.supplier_name, ti.supplier) AS Name,
                COALESCE(ml.tin_number, '-') AS \`TIN No\`,
                COALESCE(tid.hsn_code, '-') AS \`HSN Code\`,
                ti.invoice_number AS \`Invoice No\`,
                DATE_FORMAT(ti.invoice_date, '%d-%b-%Y') AS \`Invoice Date\`,
                tid.total_line_amount AS Value,
                COALESCE(vat.charge_pct, 0) AS \`Tax Rate\`,
                (SELECT JSON_OBJECTAGG(charge_type, charge_amount)
                 FROM t_tank_invoice_charges
                 WHERE invoice_dtl_id = tid.id) AS charges_json
            FROM t_tank_invoice ti
            JOIN t_tank_invoice_dtl tid ON ti.id = tid.invoice_id
            JOIN m_product mp ON tid.product_id = mp.product_id
            LEFT JOIN m_supplier ms ON ti.supplier_id = ms.supplier_id
            LEFT JOIN m_location ml ON ml.location_code = ti.location_id
            LEFT JOIN t_tank_invoice_charges vat
                ON tid.id = vat.invoice_dtl_id AND vat.charge_type = 'VAT'
            WHERE ti.location_id = :locationCode
              AND ti.invoice_date BETWEEN :reportFromDate AND :reportToDate
              AND COALESCE(mp.is_lube_product, 0) = 0
            ORDER BY ti.invoice_date, ti.invoice_number, mp.product_name`,
            {
                replacements: { locationCode, reportFromDate, reportToDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result;
    }

};
