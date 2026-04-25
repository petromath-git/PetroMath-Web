const db = require("../db/db-connection");
const Sequelize = require("sequelize");

module.exports = {

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
                COALESCE(vat.charge_amount, 0) AS VAT,
                COALESCE(add_vat.charge_amount, 0) AS \`Addition VAT\`
            FROM t_tank_invoice ti
            JOIN t_tank_invoice_dtl tid ON ti.id = tid.invoice_id
            JOIN m_product mp ON tid.product_id = mp.product_id
            LEFT JOIN m_supplier ms ON ti.supplier_id = ms.supplier_id
            LEFT JOIN m_location ml ON ml.location_code = ti.location_id
            LEFT JOIN t_tank_invoice_charges vat
                ON tid.id = vat.invoice_dtl_id AND vat.charge_type = 'VAT'
            LEFT JOIN t_tank_invoice_charges add_vat
                ON tid.id = add_vat.invoice_dtl_id AND add_vat.charge_type = 'ADDITIONAL_VAT'
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
    },

    getVatTotals: async (locationCode, reportFromDate, reportToDate) => {
        const result = await db.sequelize.query(
            `SELECT
                SUM(tid.total_line_amount) AS total_value,
                SUM(COALESCE(vat.charge_amount, 0)) AS total_vat,
                SUM(COALESCE(add_vat.charge_amount, 0)) AS total_add_vat
            FROM t_tank_invoice ti
            JOIN t_tank_invoice_dtl tid ON ti.id = tid.invoice_id
            JOIN m_product mp ON tid.product_id = mp.product_id
            LEFT JOIN t_tank_invoice_charges vat
                ON tid.id = vat.invoice_dtl_id AND vat.charge_type = 'VAT'
            LEFT JOIN t_tank_invoice_charges add_vat
                ON tid.id = add_vat.invoice_dtl_id AND add_vat.charge_type = 'ADDITIONAL_VAT'
            WHERE ti.location_id = :locationCode
              AND ti.invoice_date BETWEEN :reportFromDate AND :reportToDate
              AND COALESCE(mp.is_lube_product, 0) = 0`,
            {
                replacements: { locationCode, reportFromDate, reportToDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );
        return result[0];
    }

};
