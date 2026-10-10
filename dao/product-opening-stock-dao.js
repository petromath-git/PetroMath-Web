// dao/product-opening-stock-dao.js
//
// A product's opening stock is a single OPENING row in t_lubes_stock_adjustment,
// set and edited from the Products page. Stock is counted from the product's
// earliest stock adjustment (get_closing_product_stock_balance), so the opening
// date is the day stock tracking starts: that day's sales count against it.
// 0 is a valid opening stock.
//
// Locations that used PetroMath before stock tracking existed (config
// STOCK_OPENING_LATE_START = Y) may start tracking after their first sale;
// sales and purchases before the opening date are then ignored.
const db = require("../db/db-connection");
const { Sequelize } = require("sequelize");
const moment = require('moment');
const locationDao = require('./location-dao');
const adjustmentsDao = require('./adjustments-dao');
const locationConfigDao = require('./location-config-dao');

// Changing an opening stock once set (setting a missing one only needs
// Products page access)
const EDIT_ROLES = adjustmentsDao.DELETE_ROLES;
const LATE_START_SETTING = 'STOCK_OPENING_LATE_START';

const QT = Sequelize.QueryTypes;

// Backtick-quoted column list of t_lubes_stock_adjustment (history rows copy by name)
let adjustmentColumns = null;
async function getAdjustmentColumns() {
    if (!adjustmentColumns) {
        const rows = await db.sequelize.query(`
            SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 't_lubes_stock_adjustment'
            ORDER BY ordinal_position
        `, { type: QT.SELECT });
        adjustmentColumns = rows.map(r => '`' + r.name + '`').join(', ');
    }
    return adjustmentColumns;
}

function fmt(date) {
    return moment(date).format('DD-MMM-YYYY').toUpperCase();
}

function fmtQty(qty, unit) {
    const n = Number(qty || 0);
    return `${n % 1 === 0 ? n : n.toFixed(2)}${unit ? ' ' + unit : ''}`;
}

async function loadOpenings(whereSql, replacements) {
    return db.sequelize.query(`
        SELECT a.adjustment_id, a.product_id,
               DATE_FORMAT(a.adjustment_date, '%Y-%m-%d') AS adjustment_date,
               a.qty, a.remarks,
               a.created_by, DATE_FORMAT(a.creation_date, '%Y-%m-%d') AS creation_date,
               a.updated_by, DATE_FORMAT(a.updation_date, '%Y-%m-%d') AS updation_date
        FROM   t_lubes_stock_adjustment a
        WHERE  a.adjustment_type = 'OPENING'
          AND  ${whereSql}
        ORDER  BY a.adjustment_date, a.adjustment_id
    `, { replacements, type: QT.SELECT });
}

// SET / MISSING / MULTIPLE
function describe(entries) {
    entries = entries || [];
    const state = entries.length > 1 ? 'MULTIPLE' : entries.length === 1 ? 'SET' : 'MISSING';
    return { state, entry: entries.length === 1 ? { ...entries[0], qty: Number(entries[0].qty) } : null, entries };
}

module.exports = {

    EDIT_ROLES,
    LATE_START_SETTING,
    fmtQty,

    isLateStartAllowed: async (locationCode) => {
        const value = await locationConfigDao.getSetting(locationCode, LATE_START_SETTING);
        return String(value || 'N').trim().toUpperCase() === 'Y';
    },

    // Date offered for a new opening stock: the first shift date (that day's
    // sales count against it), else m_location.start_date, else today.
    getDateRules: async (locationCode) => {
        const today = moment().format('YYYY-MM-DD');
        const [firstShift, goLive, lateStart] = await Promise.all([
            locationDao.getFirstShiftDate(locationCode),
            locationDao.getGoLiveDate(locationCode), // first shift, else start_date
            module.exports.isLateStartAllowed(locationCode)
        ]);
        let defaultDate = firstShift || goLive || today;
        if (defaultDate > today) defaultDate = today;
        return { defaultDate, firstShift, basis: firstShift ? 'first_shift' : goLive ? 'start_date' : 'none', today, lateStart };
    },

    // Status of every stock-tracked product at a location, keyed by product_id
    getLocationStatus: async (locationCode) => {
        const entries = await loadOpenings('a.location_code = :locationCode', { locationCode });
        const byProduct = {};
        entries.forEach(e => (byProduct[e.product_id] = byProduct[e.product_id] || []).push(e));
        const result = {};
        Object.keys(byProduct).forEach(id => { result[id] = describe(byProduct[id]); });
        return result;
    },

    getStatus: async (productId, locationCode) => {
        const entries = await loadOpenings('a.product_id = :productId AND a.location_code = :locationCode', { productId, locationCode });
        return describe(entries);
    },

    // Previous versions of an opening stock entry, newest first
    getHistory: async (adjustmentId) => {
        // Before product-opening-stock.sql has run there is no history yet
        const rows = await db.sequelize.query(`
            SELECT DATE_FORMAT(adjustment_date, '%Y-%m-%d') AS adjustment_date, qty, remarks,
                   changed_by, DATE_FORMAT(changed_date, '%Y-%m-%d') AS changed_date, change_reason
            FROM   t_lubes_stock_adjustment_history
            WHERE  adjustment_id = :adjustmentId
            ORDER  BY history_id DESC
        `, { replacements: { adjustmentId }, type: QT.SELECT })
            .catch(err => { if (err.parent && err.parent.code === 'ER_NO_SUCH_TABLE') return []; throw err; });
        return rows.map(r => ({ ...r, qty: Number(r.qty) }));
    },

    // Sales and purchases of the product dated before `date` (and on/after
    // `fromDate` when given): { count, firstDate, kind } (count 0 when none).
    // The sources match get_closing_product_stock_balance.
    getMovementsBefore: async (productId, locationCode, date, fromDate) => {
        const rows = await db.sequelize.query(`
            SELECT kind, MIN(d) AS first_date, COUNT(*) AS n FROM (
                SELECT DATE(hdr.invoice_date) AS d, 'purchase' AS kind
                FROM   t_lubes_inv_lines li
                JOIN   t_lubes_inv_hdr hdr ON li.lubes_hdr_id = hdr.lubes_hdr_id
                JOIN   m_product p ON p.product_id = li.product_id AND p.is_lube_product = 1
                WHERE  li.product_id = :productId AND hdr.location_code = :locationCode
                  AND  DATE(hdr.invoice_date) < :date
                UNION ALL
                SELECT DATE(ti.invoice_date), 'purchase'
                FROM   t_tank_invoice_dtl tid
                JOIN   t_tank_invoice ti ON tid.invoice_id = ti.id
                JOIN   m_product p ON p.product_id = tid.product_id AND COALESCE(p.is_lube_product, 0) = 0
                WHERE  tid.product_id = :productId AND ti.location_id = :locationCode
                  AND  DATE(ti.invoice_date) < :date
                UNION ALL
                SELECT DATE(c.closing_date), 'sale'
                FROM   t_cashsales cs JOIN t_closing c ON cs.closing_id = c.closing_id
                WHERE  cs.product_id = :productId AND c.location_code = :locationCode
                  AND  DATE(c.closing_date) < :date
                UNION ALL
                SELECT DATE(c.closing_date), 'sale'
                FROM   t_credits tc JOIN t_closing c ON tc.closing_id = c.closing_id
                WHERE  tc.product_id = :productId AND c.location_code = :locationCode
                  AND  DATE(c.closing_date) < :date
                UNION ALL
                SELECT DATE(c.closing_date), 'sale'
                FROM   t_2toil o JOIN t_closing c ON o.closing_id = c.closing_id
                WHERE  o.product_id = :productId AND c.location_code = :locationCode
                  AND  DATE(c.closing_date) < :date
                UNION ALL
                SELECT tdb.bill_date, 'sale'
                FROM   t_day_bill tdb
                JOIN   t_day_bill_header tdbh ON tdbh.day_bill_id = tdb.day_bill_id
                JOIN   t_day_bill_items tdi ON tdi.header_id = tdbh.header_id
                JOIN   m_product p ON p.product_id = tdi.product_id AND p.is_tank_product = 1
                WHERE  tdi.product_id = :productId AND tdb.location_code = :locationCode
                  AND  tdb.bill_date < :date
                UNION ALL
                SELECT DATE(tci.closing_date), 'sale'
                FROM   t_closing_intercompany tci
                JOIN   m_product p ON p.product_id = tci.product_id AND p.is_tank_product = 1
                WHERE  tci.product_id = :productId AND tci.location_code = :locationCode
                  AND  DATE(tci.closing_date) < :date
            ) t
            WHERE d >= :fromDate
            GROUP BY kind
        `, { replacements: { productId, locationCode, date, fromDate: fromDate || '1900-01-01' }, type: QT.SELECT });

        let count = 0, firstDate = null, kind = null;
        rows.forEach(r => {
            const d = moment(r.first_date).format('YYYY-MM-DD');
            count += Number(r.n);
            if (!firstDate || d < firstDate) { firstDate = d; kind = r.kind; }
        });
        return { count, firstDate, kind };
    },

    // Earliest stock IN/OUT adjustment of the product (YYYY-MM-DD) or null.
    // The opening must not be dated after it: stock is counted from the
    // earliest adjustment, so an earlier IN/OUT would become the start.
    getFirstInOut: async (productId, locationCode) => {
        const rows = await db.sequelize.query(`
            SELECT DATE_FORMAT(MIN(adjustment_date), '%Y-%m-%d') AS d
            FROM   t_lubes_stock_adjustment
            WHERE  product_id = :productId AND location_code = :locationCode
              AND  adjustment_type IN ('IN', 'OUT')
        `, { replacements: { productId, locationCode }, type: QT.SELECT });
        return rows[0] ? rows[0].d : null;
    },

    // Checks a proposed opening date (currentDate = the existing opening's date).
    // Returns { error } when it is not allowed, or { warning } (late-start
    // locations: sales/purchases that would stop counting), or {}.
    validateDate: async (locationCode, productId, date, currentDate) => {
        if (!date || !moment(date, 'YYYY-MM-DD', true).isValid()) return { error: 'Please pick a valid date.' };
        if (date > moment().format('YYYY-MM-DD')) return { error: 'Opening stock date cannot be in the future.' };

        const firstInOut = await module.exports.getFirstInOut(productId, locationCode);
        if (firstInOut && firstInOut < date) {
            return { error: `This product has a stock adjustment on ${fmt(firstInOut)}. The opening stock must be dated on or before ${fmt(firstInOut)}.` };
        }

        const lateStart = await module.exports.isLateStartAllowed(locationCode);
        if (!lateStart) {
            const before = await module.exports.getMovementsBefore(productId, locationCode, date);
            if (before.count > 0) {
                return { error: `This product has a ${before.kind} on ${fmt(before.firstDate)}. The opening stock must be dated on or before ${fmt(before.firstDate)}.` };
            }
            return {};
        }

        // Late-start location: warn about what stops counting — everything
        // before the date for a new opening, or what lies between the old and
        // the new date when the opening moves later.
        if (currentDate && date <= currentDate) return {};
        const dropped = await module.exports.getMovementsBefore(productId, locationCode, date, currentDate);
        if (dropped.count > 0) {
            const n = dropped.count;
            return {
                warning: currentDate
                    ? `${n} sale/purchase entr${n === 1 ? 'y' : 'ies'} between ${fmt(currentDate)} and ${fmt(date)} will no longer count in stock.`
                    : `Sales and purchases before ${fmt(date)} (${n} entr${n === 1 ? 'y' : 'ies'} from ${fmt(dropped.firstDate)}) will not count in stock.`
            };
        }
        return {};
    },

    // Create the product's opening stock, or update the existing one after
    // copying its current values to t_lubes_stock_adjustment_history.
    save: async ({ locationCode, productId, date, qty, note, userName, reason }) => {
        const remarks = (note || '').trim().slice(0, 500) || 'Opening Stock';

        const t = await db.sequelize.transaction();
        try {
            // Lock the product's opening rows so two saves can't both insert
            const existing = await db.sequelize.query(`
                SELECT adjustment_id FROM t_lubes_stock_adjustment
                WHERE  adjustment_type = 'OPENING' AND product_id = :productId AND location_code = :locationCode
                FOR UPDATE
            `, { replacements: { productId, locationCode }, type: QT.SELECT, transaction: t });

            if (existing.length > 1) {
                throw new Error('This product has more than one opening stock entry. Contact support to combine them.');
            }

            let adjustmentId;
            if (existing.length === 1) {
                adjustmentId = existing[0].adjustment_id;
                const cols = await getAdjustmentColumns();
                await db.sequelize.query(`
                    INSERT INTO t_lubes_stock_adjustment_history (${cols}, changed_by, changed_date, change_reason)
                    SELECT ${cols}, :userName, NOW(), :reason
                    FROM t_lubes_stock_adjustment WHERE adjustment_id = :adjustmentId
                `, { replacements: { adjustmentId, userName, reason: reason || null }, transaction: t });

                await db.sequelize.query(`
                    UPDATE t_lubes_stock_adjustment
                    SET    adjustment_date = :date, qty = :qty, remarks = :remarks,
                           updated_by = :userName, updation_date = NOW()
                    WHERE  adjustment_id = :adjustmentId
                `, { replacements: { adjustmentId, date, qty, remarks, userName }, transaction: t });
            } else {
                const [insertId] = await db.sequelize.query(`
                    INSERT INTO t_lubes_stock_adjustment
                        (adjustment_date, product_id, adjustment_type, qty, remarks, location_code, created_by, updated_by)
                    VALUES (:date, :productId, 'OPENING', :qty, :remarks, :locationCode, :userName, :userName)
                `, { replacements: { date, productId, qty, remarks, locationCode, userName }, type: QT.INSERT, transaction: t });
                adjustmentId = insertId;
            }

            await t.commit();
            return adjustmentId;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }
};
