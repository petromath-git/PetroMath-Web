// dao/customer-opening-balance-dao.js
//
// A customer's opening balance is a single Opening Balance Entry adjustment
// (t_adjustments, adjustment_type 201, external_source CUSTOMER), set and
// edited from Customer Master. ₹0 is a valid opening balance. Customers at
// older locations may instead carry their opening in r_credit_open_bal (a row
// dated after the 2000-01-01 placeholder) — that also counts as set.
const db = require("../db/db-connection");
const { Sequelize } = require("sequelize");
const moment = require('moment');
const locationDao = require('./location-dao');
const adjustmentsDao = require('./adjustments-dao');

const OPENING_BALANCE_TYPE = '201';
// Changing an opening balance once set (setting a missing one only needs
// Customer Master edit access)
const EDIT_ROLES = adjustmentsDao.DELETE_ROLES;

const QT = Sequelize.QueryTypes;

// Backtick-quoted column list of t_adjustments (history rows copy by name)
let adjustmentColumns = null;
async function getAdjustmentColumns() {
    if (!adjustmentColumns) {
        const rows = await db.sequelize.query(`
            SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 't_adjustments'
            ORDER BY ordinal_position
        `, { type: QT.SELECT });
        adjustmentColumns = rows.map(r => '`' + r.name + '`').join(', ');
    }
    return adjustmentColumns;
}

// Signed amount: positive = customer owes us (debit), negative = we owe them
function signedAmount(row) {
    return Number(row.debit_amount || 0) - Number(row.credit_amount || 0);
}

function fmt(date) {
    return moment(date).format('DD-MMM-YYYY').toUpperCase();
}

// Opening balance entries and legacy snapshots for the given customers, keyed
// by creditlist_id: { entries: [...], legacy: {balance_date, balance} | null }
async function loadOpenings(whereSql, replacements) {
    const entries = await db.sequelize.query(`
        SELECT a.adjustment_id, a.external_id AS creditlist_id,
               DATE_FORMAT(a.adjustment_date, '%Y-%m-%d') AS adjustment_date,
               a.debit_amount, a.credit_amount, a.description,
               a.created_by, DATE_FORMAT(a.creation_date, '%Y-%m-%d') AS creation_date,
               a.updated_by, DATE_FORMAT(a.updation_date, '%Y-%m-%d') AS updation_date,
               a.recon_match_id, a.manual_recon_flag
        FROM   t_adjustments a
        JOIN   m_credit_list c ON c.creditlist_id = a.external_id
        WHERE  a.adjustment_type = :type
          AND  a.external_source = 'CUSTOMER'
          AND  a.status = 'ACTIVE'
          AND  ${whereSql}
        ORDER  BY a.adjustment_date, a.adjustment_id
    `, { replacements: { ...replacements, type: OPENING_BALANCE_TYPE }, type: QT.SELECT });

    // Latest dated legacy snapshot per customer
    const legacy = await db.sequelize.query(`
        SELECT r.creditlist_id, DATE_FORMAT(r.balance_date, '%Y-%m-%d') AS balance_date, r.balance
        FROM   r_credit_open_bal r
        JOIN   m_credit_list c ON c.creditlist_id = r.creditlist_id
        WHERE  r.balance_date > '2000-01-01'
          AND  ${whereSql}
          AND  r.balance_date = (SELECT MAX(r2.balance_date) FROM r_credit_open_bal r2
                                  WHERE r2.creditlist_id = r.creditlist_id)
    `, { replacements, type: QT.SELECT });

    const byCustomer = {};
    const slot = id => (byCustomer[id] = byCustomer[id] || { entries: [], legacy: null });
    entries.forEach(e => slot(e.creditlist_id).entries.push({ ...e, amount: signedAmount(e) }));
    legacy.forEach(l => { slot(l.creditlist_id).legacy = { balance_date: l.balance_date, balance: Number(l.balance) }; });
    return byCustomer;
}

// SET / MISSING / MULTIPLE / LEGACY, plus what the master needs to show
function describe(data) {
    const entries = (data && data.entries) || [];
    const legacy = (data && data.legacy) || null;
    let state;
    if (entries.length > 1) state = 'MULTIPLE';
    else if (entries.length === 1) state = 'SET';
    else if (legacy) state = 'LEGACY';
    else state = 'MISSING';
    return { state, entry: entries.length === 1 ? entries[0] : null, entries, legacy };
}

module.exports = {

    OPENING_BALANCE_TYPE,
    EDIT_ROLES,

    // Date offered for a new opening balance: the day before the first shift,
    // else the day before m_location.start_date, else yesterday.
    // minDate is the earliest date allowed (the DB go-live trigger only lets an
    // opening balance before the first shift sit on the day before it).
    getDateRules: async (locationCode) => {
        const today = moment().format('YYYY-MM-DD');
        const firstShift = await locationDao.getFirstShiftDate(locationCode);
        if (firstShift) {
            const d = moment(firstShift).subtract(1, 'day').format('YYYY-MM-DD');
            return { defaultDate: d, minDate: d, firstShift, basis: 'first_shift', today };
        }
        const goLive = await locationDao.getGoLiveDate(locationCode); // start_date when no shift
        if (goLive) {
            const d = moment(goLive).subtract(1, 'day').format('YYYY-MM-DD');
            return { defaultDate: d > today ? today : d, minDate: null, firstShift: null, basis: 'start_date', today };
        }
        return { defaultDate: moment().subtract(1, 'day').format('YYYY-MM-DD'), minDate: null, firstShift: null, basis: 'none', today };
    },

    // Status of every customer at a location, keyed by creditlist_id
    getLocationStatus: async (locationCode) => {
        const data = await loadOpenings('c.location_code = :locationCode', { locationCode });
        const customers = await db.sequelize.query(`
            SELECT creditlist_id FROM m_credit_list
            WHERE location_code = :locationCode AND COALESCE(card_flag, 'N') <> 'Y'
        `, { replacements: { locationCode }, type: QT.SELECT });
        const result = {};
        customers.forEach(c => { result[c.creditlist_id] = describe(data[c.creditlist_id]); });
        return result;
    },

    getStatus: async (creditlistId) => {
        const data = await loadOpenings('c.creditlist_id = :creditlistId', { creditlistId });
        return describe(data[creditlistId]);
    },

    // Previous versions of an opening balance entry, newest first
    getHistory: async (adjustmentId) => {
        // Before customer-opening-balance.sql has run there is no history yet
        const rows = await db.sequelize.query(`
            SELECT DATE_FORMAT(adjustment_date, '%Y-%m-%d') AS adjustment_date,
                   debit_amount, credit_amount, description,
                   changed_by, DATE_FORMAT(changed_date, '%Y-%m-%d') AS changed_date, change_reason
            FROM   t_adjustments_history
            WHERE  adjustment_id = :adjustmentId
            ORDER  BY history_id DESC
        `, { replacements: { adjustmentId }, type: QT.SELECT })
            .catch(err => { if (err.parent && err.parent.code === 'ER_NO_SUCH_TABLE') return []; throw err; });
        return rows.map(r => ({ ...r, amount: signedAmount(r) }));
    },

    // Earliest bill / receipt / other adjustment for the customer (YYYY-MM-DD),
    // with what it was — the opening balance may not be dated after it.
    getFirstTransaction: async (creditlistId, excludeAdjustmentId) => {
        const rows = await db.sequelize.query(`
            SELECT tran_date, kind FROM (
                SELECT MIN(COALESCE(tc.credit_bill_date, DATE(cl.closing_date))) AS tran_date, 'bill' AS kind
                FROM   t_credits tc JOIN t_closing cl ON cl.closing_id = tc.closing_id
                WHERE  tc.creditlist_id = :creditlistId
                UNION ALL
                SELECT MIN(bcl.closing_date), 'bowser bill'
                FROM   t_bowser_credits bc JOIN t_bowser_closing bcl ON bcl.bowser_closing_id = bc.bowser_closing_id
                WHERE  bc.creditlist_id = :creditlistId
                UNION ALL
                SELECT MIN(DATE(receipt_date)), 'receipt'
                FROM   t_receipts WHERE creditlist_id = :creditlistId
                UNION ALL
                SELECT MIN(adjustment_date), 'adjustment'
                FROM   t_adjustments
                WHERE  external_source = 'CUSTOMER' AND external_id = :creditlistId
                  AND  status = 'ACTIVE' AND adjustment_id <> :excludeId
            ) t
            WHERE tran_date IS NOT NULL
            ORDER BY tran_date
            LIMIT 1
        `, { replacements: { creditlistId, excludeId: excludeAdjustmentId || 0 }, type: QT.SELECT });
        if (!rows.length) return null;
        return { date: moment(rows[0].tran_date).format('YYYY-MM-DD'), kind: rows[0].kind };
    },

    // Checks a proposed opening balance date; returns an error message or null
    validateDate: async (locationCode, creditlistId, date, status) => {
        if (!date || !moment(date, 'YYYY-MM-DD', true).isValid()) return 'Please pick a valid date.';
        if (date > moment().format('YYYY-MM-DD')) return 'Opening balance date cannot be in the future.';

        const rules = await module.exports.getDateRules(locationCode);
        if (rules.firstShift && date < rules.firstShift && date !== rules.minDate) {
            return `Opening balance must be dated ${fmt(rules.minDate)} (the day before your first shift on ${fmt(rules.firstShift)}) or later.`;
        }

        const existingId = status && status.entry ? status.entry.adjustment_id : null;
        // (no creditlistId = customer not created yet, so nothing to clash with)
        const first = creditlistId ? await module.exports.getFirstTransaction(creditlistId, existingId) : null;
        if (first && first.date < date) {
            return `This customer has a ${first.kind} on ${fmt(first.date)}. The opening balance must be dated on or before ${fmt(first.date)}.`;
        }

        if (status && status.legacy && date < status.legacy.balance_date) {
            return `This customer's balance is carried forward from ${fmt(status.legacy.balance_date)}; the opening balance cannot be dated before that.`;
        }
        return null;
    },

    // Create the customer's opening balance, or update the existing one after
    // copying its current values to t_adjustments_history.
    // amount is signed: positive = customer owes us, negative = we owe them.
    save: async ({ locationCode, creditlistId, date, amount, note, userName, reason }) => {
        const description = (note || '').trim().slice(0, 500) || 'Opening Balance';
        const debit = amount >= 0 ? amount : null;
        const credit = amount < 0 ? -amount : null;

        const t = await db.sequelize.transaction();
        try {
            // Lock the customer's opening rows so two saves can't both insert
            const existing = await db.sequelize.query(`
                SELECT adjustment_id FROM t_adjustments
                WHERE  adjustment_type = :type AND external_source = 'CUSTOMER'
                  AND  external_id = :creditlistId AND status = 'ACTIVE'
                FOR UPDATE
            `, { replacements: { type: OPENING_BALANCE_TYPE, creditlistId }, type: QT.SELECT, transaction: t });

            if (existing.length > 1) {
                throw new Error('This customer has more than one opening balance entry. Delete the wrong one on the Adjustments screen first.');
            }

            let adjustmentId;
            if (existing.length === 1) {
                adjustmentId = existing[0].adjustment_id;
                const cols = await getAdjustmentColumns();
                await db.sequelize.query(`
                    INSERT INTO t_adjustments_history (${cols}, changed_by, changed_date, change_reason)
                    SELECT ${cols}, :userName, NOW(), :reason
                    FROM t_adjustments WHERE adjustment_id = :adjustmentId
                `, { replacements: { adjustmentId, userName, reason: reason || null }, transaction: t });

                await db.sequelize.query(`
                    UPDATE t_adjustments
                    SET    adjustment_date = :date, debit_amount = :debit, credit_amount = :credit,
                           description = :description, updated_by = :userName, updation_date = NOW()
                    WHERE  adjustment_id = :adjustmentId
                `, { replacements: { adjustmentId, date, debit, credit, description, userName }, transaction: t });
            } else {
                const [insertId] = await db.sequelize.query(`
                    INSERT INTO t_adjustments
                        (adjustment_date, location_code, description, external_id, external_source,
                         debit_amount, credit_amount, adjustment_type, status, created_by, updated_by)
                    VALUES (:date, :locationCode, :description, :creditlistId, 'CUSTOMER',
                            :debit, :credit, :type, 'ACTIVE', :userName, :userName)
                `, { replacements: { date, locationCode, description, creditlistId, debit, credit, type: OPENING_BALANCE_TYPE, userName }, type: QT.INSERT, transaction: t });
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
