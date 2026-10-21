// dao/deadline-dao.js — deadlines & renewals (m_deadline_item, t_deadline_renewal),
// bank holiday calendar (m_bank_holiday). See db/migrations/deadline-overhaul.sql.
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");

const q = (sql, replacements, opts = {}) =>
    db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...opts });
const run = (sql, replacements, opts = {}) =>
    db.sequelize.query(sql, { replacements, ...opts });

// days_left < 0 = overdue. "Due soon" = inside the item's own reminder window.
const ITEM_SELECT = `
    SELECT di.item_id, di.location_code, di.category_id, c.category_code, c.category_name,
           di.title, di.reference_no, DATE_FORMAT(di.due_date, '%Y-%m-%d') AS due_date,
           di.repeat_months, di.remind_days, di.notes, di.status,
           DATE_FORMAT(di.closed_date, '%Y-%m-%d') AS closed_date, di.closed_by,
           DATEDIFF(di.due_date, CURDATE()) AS days_left,
           (SELECT COUNT(*) FROM t_deadline_renewal r WHERE r.item_id = di.item_id) AS renewal_count
    FROM m_deadline_item di
    JOIN m_deadline_category c ON c.category_id = di.category_id`;

module.exports = {
    getCategories: () =>
        q(`SELECT category_id, category_code, category_name, default_remind_days
           FROM m_deadline_category ORDER BY sort_order, category_name`),

    findItems: (locationCode) =>
        q(`${ITEM_SELECT}
           WHERE di.location_code = :locationCode
           ORDER BY di.status = 'DONE', di.due_date, di.title`, { locationCode }),

    findItem: async (itemId, locationCode) => {
        const rows = await q(`${ITEM_SELECT} WHERE di.item_id = :itemId AND di.location_code = :locationCode`,
            { itemId, locationCode });
        return rows[0] || null;
    },

    // Open items that are overdue or inside their reminder window — home page, DSR, push digest
    findAttentionItems: (locationCode) =>
        q(`${ITEM_SELECT}
           WHERE di.location_code = :locationCode AND di.status = 'OPEN'
             AND DATEDIFF(di.due_date, CURDATE()) <= di.remind_days
           ORDER BY di.due_date, di.title`, { locationCode }),

    // Every location with at least one open item that needs attention today (push digest)
    findLocationsNeedingAttention: () =>
        q(`SELECT DISTINCT di.location_code
           FROM m_deadline_item di
           WHERE di.status = 'OPEN' AND DATEDIFF(di.due_date, CURDATE()) <= di.remind_days`),

    getReferenceSuggestions: (locationCode) =>
        q(`SELECT DISTINCT reference_no FROM m_deadline_item
           WHERE location_code = :locationCode AND reference_no IS NOT NULL AND reference_no <> ''
           ORDER BY reference_no`, { locationCode }),

    getRenewals: (itemId) =>
        q(`SELECT DATE_FORMAT(previous_due_date, '%Y-%m-%d') AS previous_due_date,
                  DATE_FORMAT(done_date, '%Y-%m-%d') AS done_date,
                  DATE_FORMAT(next_due_date, '%Y-%m-%d') AS next_due_date,
                  r.note, COALESCE(p.Person_Name, r.done_by) AS done_by_name
           FROM t_deadline_renewal r
           LEFT JOIN m_persons p ON p.Person_id = r.done_by
           WHERE r.item_id = :itemId
           ORDER BY r.done_date DESC, r.renewal_id DESC`, { itemId }),

    createItem: async (locationCode, item, personId) => {
        const [id] = await run(
            `INSERT INTO m_deadline_item
                 (location_code, category_id, title, reference_no, due_date, repeat_months, remind_days, notes,
                  status, created_by, updated_by)
             VALUES (:locationCode, :categoryId, :title, :referenceNo, :dueDate, :repeatMonths, :remindDays, :notes,
                     'OPEN', :personId, :personId)`,
            { locationCode, ...item, personId }, { type: QueryTypes.INSERT });
        return id;
    },

    updateItem: (itemId, locationCode, item, personId) =>
        run(`UPDATE m_deadline_item
             SET category_id = :categoryId, title = :title, reference_no = :referenceNo, due_date = :dueDate,
                 repeat_months = :repeatMonths, remind_days = :remindDays, notes = :notes, updated_by = :personId
             WHERE item_id = :itemId AND location_code = :locationCode`,
            { itemId, locationCode, ...item, personId }, { type: QueryTypes.UPDATE }),

    // Renewed / done: log it, then either move to the next due date or close.
    // A DONE item can be renewed too (re-opens it with the new date).
    renewItem: (item, doneDate, nextDueDate, note, personId) =>
        db.sequelize.transaction(async (transaction) => {
            await run(
                `INSERT INTO t_deadline_renewal (item_id, previous_due_date, done_date, next_due_date, note, done_by)
                 VALUES (:itemId, :previousDueDate, :doneDate, :nextDueDate, :note, :personId)`,
                { itemId: item.item_id, previousDueDate: item.due_date, doneDate, nextDueDate, note, personId },
                { type: QueryTypes.INSERT, transaction });
            if (nextDueDate) {
                await run(`UPDATE m_deadline_item
                           SET due_date = :nextDueDate, status = 'OPEN', closed_date = NULL, closed_by = NULL, updated_by = :personId
                           WHERE item_id = :itemId`,
                    { itemId: item.item_id, nextDueDate, personId }, { type: QueryTypes.UPDATE, transaction });
            } else {
                await run(`UPDATE m_deadline_item
                           SET status = 'DONE', closed_date = :doneDate, closed_by = :personId, updated_by = :personId
                           WHERE item_id = :itemId`,
                    { itemId: item.item_id, doneDate, personId }, { type: QueryTypes.UPDATE, transaction });
            }
        }),

    deleteItem: (itemId, locationCode) =>
        db.sequelize.transaction(async (transaction) => {
            await run(`DELETE r FROM t_deadline_renewal r
                       JOIN m_deadline_item di ON di.item_id = r.item_id
                       WHERE r.item_id = :itemId AND di.location_code = :locationCode`,
                { itemId, locationCode }, { type: QueryTypes.DELETE, transaction });
            await run(`DELETE FROM m_deadline_item WHERE item_id = :itemId AND location_code = :locationCode`,
                { itemId, locationCode }, { type: QueryTypes.DELETE, transaction });
        }),

    // ---- Bank holidays ----

    holidayExists: async (locationCode, holidayDate) => {
        const rows = await q(`SELECT 1 FROM m_bank_holiday WHERE location_code = :locationCode AND holiday_date = :holidayDate`,
            { locationCode, holidayDate });
        return rows.length > 0;
    },

    // Reading (hand rows + RBI list + 2nd/4th Saturdays) is in services/bank-holiday-service.js.
    // hidden = true: "not a holiday here" — removes the automatic holiday on that date.
    createHoliday: (locationCode, holidayDate, description, personId, hidden = false) =>
        run(`INSERT INTO m_bank_holiday (location_code, holiday_date, description, hidden_flag, created_by)
             VALUES (:locationCode, :holidayDate, :description, :hiddenFlag, :personId)`,
            { locationCode, holidayDate, description, hiddenFlag: hidden ? 'Y' : 'N', personId }, { type: QueryTypes.INSERT }),

    // BULKDELETE (not DELETE) makes Sequelize 5 return the affected row count
    deleteHoliday: (holidayId, locationCode) =>
        run(`DELETE FROM m_bank_holiday WHERE holiday_id = :holidayId AND location_code = :locationCode`,
            { holidayId, locationCode }, { type: QueryTypes.BULKDELETE }),
};
