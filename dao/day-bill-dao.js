// dao/day-bill-dao.js
const db = require("../db/db-connection");
const { Op, Sequelize } = require("sequelize");

const DayBillDao = {

    // ─── Fetch existing day bill ──────────────────────────────────────────────

    findByDate: (locationCode, billDate) => {
        return db.day_bill.findOne({
            where: { location_code: locationCode, bill_date: billDate },
            include: [{
                model: db.day_bill_header,
                as: 'headers',
                include: [{
                    model: db.day_bill_items,
                    as: 'items',
                    include: [{ model: db.product }]
                }, {
                    model: db.credit,
                    as: 'vendor',
                    required: false
                }]
            }]
        });
    },

    findById: (dayBillId) => {
        return db.day_bill.findOne({
            where: { day_bill_id: dayBillId },
            include: [{
                model: db.day_bill_header,
                as: 'headers',
                include: [{
                    model: db.day_bill_items,
                    as: 'items',
                    include: [{ model: db.product }]
                }, {
                    model: db.credit,
                    as: 'vendor',
                    required: false
                }]
            }]
        });
    },

    findList: (locationCode, fromDate, toDate) => {
        return db.sequelize.query(
            `SELECT
                db.day_bill_id,
                DATE_FORMAT(db.bill_date, '%Y-%m-%d') as bill_date,
                db.cashflow_id,
                db.status,
                db.updated_by,
                DATE_FORMAT(db.updation_date, '%Y-%m-%d') as updation_date,
                COUNT(DISTINCT dbh.header_id) as bill_count,
                SUM(dbh.total_amount) as grand_total
            FROM t_day_bill db
            LEFT JOIN t_day_bill_header dbh ON db.day_bill_id = dbh.day_bill_id
            WHERE db.location_code = :locationCode
              AND db.bill_date BETWEEN :fromDate AND :toDate
            GROUP BY db.day_bill_id
            ORDER BY db.bill_date DESC`,
            {
                replacements: { locationCode, fromDate, toDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // ─── Raw data for calculation ─────────────────────────────────────────────

    // Returns: product_id, product_name, hsn_code, cgst_percent, sgst_percent,
    //          pumped_qty, price (weighted avg price for the day)
    getPumpedQtyByDate: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                p.product_id,
                p.product_name,
                COALESCE(p.hsn_code, '') as hsn_code,
                COALESCE(p.cgst_percent, 0) as cgst_percent,
                COALESCE(p.sgst_percent, 0) as sgst_percent,
                SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) as pumped_qty,
                -- weighted average price for the day
                SUM((r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)) * r.price)
                    / NULLIF(SUM(r.closing_reading - r.opening_reading - COALESCE(r.testing, 0)), 0) as price
            FROM t_reading r
            JOIN t_closing c ON r.closing_id = c.closing_id
            JOIN m_pump mp ON r.pump_id = mp.pump_id
                AND DATE(c.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
            JOIN m_product p ON mp.product_code = p.product_name
                AND p.location_code = c.location_code
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
            GROUP BY p.product_id, p.product_name, p.hsn_code, p.cgst_percent, p.sgst_percent
            HAVING pumped_qty > 0`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // Returns: product_id, product_name, hsn_code, cgst_percent, sgst_percent,
    //          sold_qty, price
    get2TOilQtyByDate: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                p.product_id,
                p.product_name,
                COALESCE(p.hsn_code, '') as hsn_code,
                COALESCE(p.cgst_percent, 0) as cgst_percent,
                COALESCE(p.sgst_percent, 0) as sgst_percent,
                SUM(ot.given_qty - COALESCE(ot.returned_qty, 0)) as sold_qty,
                -- weighted average price
                SUM((ot.given_qty - COALESCE(ot.returned_qty, 0)) * ot.price)
                    / NULLIF(SUM(ot.given_qty - COALESCE(ot.returned_qty, 0)), 0) as price
            FROM t_2toil ot
            JOIN t_closing c ON ot.closing_id = c.closing_id
            JOIN m_product p ON ot.product_id = p.product_id
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
            GROUP BY p.product_id, p.product_name, p.hsn_code, p.cgst_percent, p.sgst_percent
            HAVING sold_qty > 0`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // Returns: product_id, cashsale_qty
    // Only for products that ARE reading products (already individually billed in shift).
    // These quantities must be subtracted from pumped_qty before day bill calculation.
    getCashSaleQtyForReadingProducts: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                cs.product_id,
                SUM(cs.qty) as cashsale_qty
            FROM t_cashsales cs
            JOIN t_closing c ON cs.closing_id = c.closing_id
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
              -- Only reading products (products that have a pump configured for this location)
              AND cs.product_id IN (
                  SELECT DISTINCT p2.product_id
                  FROM m_pump mp
                  JOIN m_product p2 ON mp.product_code = p2.product_name
                      AND p2.location_code = mp.location_code
                  WHERE mp.location_code = :locationCode
              )
            GROUP BY cs.product_id`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // Returns: product_id, credit_qty
    getCreditQtyByDate: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                tc.product_id,
                SUM(tc.qty) as credit_qty
            FROM t_credits tc
            JOIN t_closing c ON tc.closing_id = c.closing_id
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
            GROUP BY tc.product_id`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // Returns: vendor_id, vendor_name, digital_amount
    getDigitalAmountByDate: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                ds.vendor_id,
                cl.Company_Name as vendor_name,
                SUM(ds.amount) as digital_amount
            FROM t_digital_sales ds
            JOIN t_closing c ON ds.closing_id = c.closing_id
            JOIN m_credit_list cl ON ds.vendor_id = cl.creditlist_id
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
            GROUP BY ds.vendor_id, cl.Company_Name`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // Returns list of closed shifts for the date (for the Header tab)
    getShiftsByDate: (locationCode, billDate) => {
        return db.sequelize.query(
            `SELECT
                c.closing_id,
                DATE_FORMAT(c.closing_date, '%Y-%m-%d') as closing_date,
                c.close_reading_time,
                c.cashier_id,
                p.Person_Name as cashier_name,
                c.closing_status,
                c.cashflow_id
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            WHERE c.location_code = :locationCode
              AND DATE_FORMAT(c.closing_date, '%Y-%m-%d') = :billDate
              AND c.closing_status = 'CLOSED'
            ORDER BY c.closing_id ASC`,
            {
                replacements: { locationCode, billDate },
                type: db.sequelize.QueryTypes.SELECT
            }
        );
    },

    // ─── Save / update ────────────────────────────────────────────────────────

    upsertDayBill: (locationCode, billDate, cashflowId, userId) => {
        return db.day_bill.findOne({ where: { location_code: locationCode, bill_date: billDate } })
            .then(existing => {
                if (existing) {
                    return db.day_bill.update(
                        { cashflow_id: cashflowId || existing.cashflow_id,
                          updated_by: userId,
                          updation_date: new Date() },
                        { where: { day_bill_id: existing.day_bill_id } }
                    ).then(() => existing.day_bill_id);
                } else {
                    return db.day_bill.create({
                        location_code: locationCode,
                        bill_date: billDate,
                        cashflow_id: cashflowId || null,
                        status: 'ACTIVE',
                        created_by: userId,
                        creation_date: new Date(),
                        updated_by: userId,
                        updation_date: new Date()
                    }).then(rec => rec.day_bill_id);
                }
            });
    },

    // Returns preserved bill numbers keyed by "bill_type:vendor_id"
    getExistingBillNumbers: (dayBillId) => {
        return db.day_bill_header.findAll({ where: { day_bill_id: dayBillId } })
            .then(headers => {
                const map = {};
                headers.forEach(h => {
                    const key = `${h.bill_type}:${h.vendor_id || 'null'}`;
                    if (h.bill_number) map[key] = h.bill_number;
                });
                return map;
            });
    },

    deleteHeadersAndItems: (dayBillId) => {
        return db.day_bill_header.findAll({ where: { day_bill_id: dayBillId } })
            .then(headers => {
                const headerIds = headers.map(h => h.header_id);
                if (!headerIds.length) return Promise.resolve();
                return db.day_bill_items.destroy({ where: { header_id: { [Op.in]: headerIds } } })
                    .then(() => db.day_bill_header.destroy({ where: { day_bill_id: dayBillId } }));
            });
    },

    insertHeaders: (headers) => {
        return db.day_bill_header.bulkCreate(headers, { returning: true });
    },

    insertItems: (items) => {
        return db.day_bill_items.bulkCreate(items);
    },

    // Call the stored procedure — all business logic lives in DB
    generateDayBill: (locationCode, billDate, userId) => {
        return db.sequelize.query(
            'CALL generate_day_bill(:locationCode, :billDate, :userId)',
            {
                replacements: {
                    locationCode,
                    billDate,
                    userId: userId || 'system'
                },
                type: db.sequelize.QueryTypes.RAW
            }
        );
    },

    // Save bill numbers (user-edited)
    saveBillNumbers: (updates, userId) => {
        // updates: array of { header_id, bill_number }
        const promises = updates.map(u =>
            db.day_bill_header.update(
                { bill_number: u.bill_number, updated_by: userId, updation_date: new Date() },
                { where: { header_id: u.header_id } }
            )
        );
        return Promise.all(promises);
    },

    // Touch updation_date on the parent day_bill after bill numbers saved
    // Optionally also stamps cashflow_id (pass null to leave unchanged)
    touchDayBill: (dayBillId, userId, cashflowId) => {
        const fields = { updated_by: userId, updation_date: new Date() };
        if (cashflowId != null) fields.cashflow_id = cashflowId;
        return db.day_bill.update(fields, { where: { day_bill_id: dayBillId } });
    }
};

module.exports = DayBillDao;
