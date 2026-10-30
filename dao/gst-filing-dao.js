// Tables behind GST self-filing (db/migrations/gst-self-filing.sql): HSN descriptions,
// reverse-charge self-invoices, uploaded GSTR-2B lines, supplier ITC classes and the
// per-month GSTR-3B inputs. Plus the purchase / sale-day figures the returns need.
const db = require("../db/db-connection");
const Sequelize = require("sequelize");

const select = (sql, replacements) => db.sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });
const run = (sql, replacements, transaction) => db.sequelize.query(sql, { replacements, transaction });

module.exports = {
    // ---------- HSN ----------
    getHsnMaster: () => select(`SELECT hsn_code, description FROM m_gst_hsn ORDER BY hsn_code`, {}),

    saveHsn: (hsnCode, description, user) => run(
        `INSERT INTO m_gst_hsn (hsn_code, description, created_by, updated_by)
         VALUES (:hsnCode, :description, :user, :user)
         ON DUPLICATE KEY UPDATE description = VALUES(description), updated_by = VALUES(updated_by)`,
        { hsnCode, description, user }),

    // Products of the location with the fuel flag the GST Summary uses (pump product, not lube).
    getProductsForHsn: (locationCode) => select(
        `SELECT mp.product_id, mp.product_name, mp.unit, TRIM(mp.hsn_code) AS hsn_code,
                COALESCE(mp.cgst_percent, 0) + COALESCE(mp.sgst_percent, 0) AS gst_rate,
                COALESCE(mp.is_lube_product, 0) AS is_lube_product,
                CASE WHEN COALESCE(mp.is_lube_product, 0) = 0
                      AND mp.product_name IN (SELECT DISTINCT product_code FROM m_pump WHERE location_code = :locationCode)
                     THEN 1 ELSE 0 END AS is_fuel
         FROM m_product mp
         WHERE mp.location_code = :locationCode
         ORDER BY is_fuel DESC, mp.product_name`,
        { locationCode }),

    // Products at the reference locations whose HSN is in the HSN list.
    getReferenceHsn: (locationCodes) => select(
        `SELECT mp.location_code, mp.product_name, TRIM(mp.hsn_code) AS hsn_code
         FROM m_product mp
         JOIN m_gst_hsn h ON h.hsn_code = TRIM(mp.hsn_code)
         WHERE mp.location_code IN (:locationCodes)
         ORDER BY FIELD(mp.location_code, :locationCodes), mp.product_id`,
        { locationCodes }),

    getHsnDefaults: () => select(`SELECT category, hsn_code FROM m_gst_hsn_default ORDER BY category`, {}),

    saveHsnDefault: (category, hsnCode, user) => run(
        `INSERT INTO m_gst_hsn_default (category, hsn_code, updated_by) VALUES (:category, :hsnCode, :user)
         ON DUPLICATE KEY UPDATE hsn_code = VALUES(hsn_code), updated_by = VALUES(updated_by)`,
        { category, hsnCode, user }),

    updateProductHsn:(locationCode, productId, hsnCode, user) => run(
        `UPDATE m_product SET hsn_code = :hsnCode, updated_by = :user
         WHERE product_id = :productId AND location_code = :locationCode`,
        { locationCode, productId, hsnCode, user }),

    // ---------- Reverse charge ----------
    getRcmEntries: (locationCode, returnPeriod) => select(
        `SELECT * FROM t_gst_rcm_inward
         WHERE location_code = :locationCode AND return_period = :returnPeriod
         ORDER BY self_invoice_date, rcm_id`,
        { locationCode, returnPeriod }),

    getRcmEntry: async (locationCode, rcmId) => (await select(
        `SELECT * FROM t_gst_rcm_inward WHERE rcm_id = :rcmId AND location_code = :locationCode`,
        { locationCode, rcmId }))[0],

    insertRcm: (row) => run(
        `INSERT INTO t_gst_rcm_inward
            (location_code, return_period, supplier_name, description, sac_code, taxable_value, gst_rate,
             igst, cgst, sgst, self_invoice_no, self_invoice_date, itc_class, notes, created_by, updated_by)
         VALUES (:location_code, :return_period, :supplier_name, :description, :sac_code, :taxable_value, :gst_rate,
             :igst, :cgst, :sgst, :self_invoice_no, :self_invoice_date, :itc_class, :notes, :user, :user)`,
        row),

    updateRcm: (row) => run(
        `UPDATE t_gst_rcm_inward
         SET supplier_name = :supplier_name, description = :description, sac_code = :sac_code,
             taxable_value = :taxable_value, gst_rate = :gst_rate, igst = :igst, cgst = :cgst, sgst = :sgst,
             self_invoice_no = :self_invoice_no, self_invoice_date = :self_invoice_date,
             itc_class = :itc_class, notes = :notes, updated_by = :user
         WHERE rcm_id = :rcm_id AND location_code = :location_code`,
        row),

    deleteRcm: (locationCode, rcmId) => run(
        `DELETE FROM t_gst_rcm_inward WHERE rcm_id = :rcmId AND location_code = :locationCode`,
        { locationCode, rcmId }),

    // ---------- GSTR-2B ----------
    get2bInvoices: (locationCode, returnPeriod) => select(
        `SELECT * FROM t_gst_2b_invoice
         WHERE location_code = :locationCode AND return_period = :returnPeriod
         ORDER BY supplier_name, doc_date, doc_no`,
        { locationCode, returnPeriod }),

    get2bUploadInfo: async (locationCode, returnPeriod) => (await select(
        `SELECT COUNT(*) AS line_count, MAX(upload_date) AS upload_date, MAX(uploaded_by) AS uploaded_by
         FROM t_gst_2b_invoice WHERE location_code = :locationCode AND return_period = :returnPeriod`,
        { locationCode, returnPeriod }))[0],

    // A new upload replaces the month, in one transaction.
    replace2bInvoices: (locationCode, returnPeriod, rows, user) => db.sequelize.transaction(async (t) => {
        await run(`DELETE FROM t_gst_2b_invoice WHERE location_code = :locationCode AND return_period = :returnPeriod`,
            { locationCode, returnPeriod }, t);
        for (const r of rows) {
            await run(
                `INSERT INTO t_gst_2b_invoice
                    (location_code, return_period, section, supplier_gstin, supplier_name, supplier_period, doc_no, doc_date,
                     doc_type, reverse_charge, itc_available, itc_reason, taxable_value, igst, cgst, sgst, cess,
                     itc_class, class_source, uploaded_by)
                 VALUES (:locationCode, :returnPeriod, :section, :supplier_gstin, :supplier_name, :supplier_period, :doc_no, :doc_date,
                     :doc_type, :reverse_charge, :itc_available, :itc_reason, :taxable_value, :igst, :cgst, :sgst, :cess,
                     :itc_class, :class_source, :user)`,
                Object.assign({ locationCode, returnPeriod, user }, r), t);
        }
    }),

    set2bClass: (locationCode, gst2bId, itcClass) => run(
        `UPDATE t_gst_2b_invoice SET itc_class = :itcClass, class_source = 'USER'
         WHERE gst2b_id = :gst2bId AND location_code = :locationCode`,
        { locationCode, gst2bId, itcClass }),

    get2bInvoice: async (locationCode, gst2bId) => (await select(
        `SELECT * FROM t_gst_2b_invoice WHERE gst2b_id = :gst2bId AND location_code = :locationCode`,
        { locationCode, gst2bId }))[0],

    getSupplierClasses: (locationCode) => select(
        `SELECT supplier_gstin, itc_class FROM m_gst_itc_supplier WHERE location_code = :locationCode`,
        { locationCode }),

    saveSupplierClass: (locationCode, supplierGstin, itcClass, user) => run(
        `INSERT INTO m_gst_itc_supplier (location_code, supplier_gstin, itc_class, updated_by)
         VALUES (:locationCode, :supplierGstin, :itcClass, :user)
         ON DUPLICATE KEY UPDATE itc_class = VALUES(itc_class), updated_by = VALUES(updated_by)`,
        { locationCode, supplierGstin, itcClass, user }),

    // ---------- GSTR-3B inputs ----------
    getPeriod: async (locationCode, returnPeriod) => (await select(
        `SELECT * FROM t_gst_period WHERE location_code = :locationCode AND return_period = :returnPeriod`,
        { locationCode, returnPeriod }))[0],

    savePeriod: (row) => run(
        `INSERT INTO t_gst_period
            (location_code, return_period, ecl_open_igst, ecl_open_cgst, ecl_open_sgst,
             ecl_close_igst, ecl_close_cgst, ecl_close_sgst,
             interest_cgst, interest_sgst, late_fee_cgst, late_fee_sgst, notes, updated_by)
         VALUES (:location_code, :return_period, :ecl_open_igst, :ecl_open_cgst, :ecl_open_sgst,
             :ecl_close_igst, :ecl_close_cgst, :ecl_close_sgst,
             :interest_cgst, :interest_sgst, :late_fee_cgst, :late_fee_sgst, :notes, :user)
         ON DUPLICATE KEY UPDATE
             ecl_open_igst = VALUES(ecl_open_igst), ecl_open_cgst = VALUES(ecl_open_cgst), ecl_open_sgst = VALUES(ecl_open_sgst),
             ecl_close_igst = VALUES(ecl_close_igst), ecl_close_cgst = VALUES(ecl_close_cgst), ecl_close_sgst = VALUES(ecl_close_sgst),
             interest_cgst = VALUES(interest_cgst), interest_sgst = VALUES(interest_sgst),
             late_fee_cgst = VALUES(late_fee_cgst), late_fee_sgst = VALUES(late_fee_sgst),
             notes = VALUES(notes), updated_by = VALUES(updated_by)`,
        row),

    // ---------- Figures from the books ----------
    // Fuel bought from the oil company in the month (3B Table 5, non-GST inward).
    // line_amount = before VAT (auditor's figure since May-2026); charges = VAT etc.
    getFuelPurchases: (locationCode, fromDate, toDate) => select(
        `SELECT ti.id, ti.invoice_number, ti.invoice_date, ti.total_invoice_amount,
                SUM(tid.total_line_amount) AS line_amount,
                SUM((SELECT COALESCE(SUM(c.charge_amount), 0) FROM t_tank_invoice_charges c
                     WHERE c.invoice_dtl_id = tid.id)) AS charges
         FROM t_tank_invoice ti
         JOIN t_tank_invoice_dtl tid ON tid.invoice_id = ti.id
         WHERE ti.location_id = :locationCode
           AND ti.invoice_date BETWEEN :fromDate AND :toDate
         GROUP BY ti.id, ti.invoice_number, ti.invoice_date, ti.total_invoice_amount
         ORDER BY ti.invoice_date, ti.invoice_number`,
        { locationCode, fromDate, toDate }),

    // Days with a closed shift: one day bill per product group per day (Table 13).
    getSaleDays: (locationCode, fromDate, toDate) => select(
        `SELECT DISTINCT DATE_FORMAT(closing_date, '%Y-%m-%d') AS sale_date
         FROM t_closing
         WHERE location_code = :locationCode AND closing_status = 'CLOSED'
           AND DATE(closing_date) BETWEEN :fromDate AND :toDate
         ORDER BY sale_date`,
        { locationCode, fromDate, toDate })
};
