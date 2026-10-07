const db = require("../db/db-connection");
const Expense = db.expense;
const Sequelize = require("sequelize");
const { QueryTypes } = Sequelize;

// Shift closing matches these by NAME (notes become mandatory; Suspense is hidden
// on new rows) — see populateDefaultExpenseAmt / addExpenses mixin. Renaming or
// deleting them would silently change closing behaviour, so the master locks them.
const PROTECTED_EXPENSE_NAMES = ['OTHERS', 'SUSPENSE', 'SELF'];

const isProtectedName = (name) => PROTECTED_EXPENSE_NAMES.includes(String(name || '').trim().toUpperCase());

module.exports = {
    PROTECTED_EXPENSE_NAMES,
    isProtectedName,

    // Expense master list with how many shift entries use each expense.
    // t_expense_deleted counts too: restore_closing puts those rows back with
    // the same expense_id, so deleting the master would orphan a restored shift.
    findExpensesWithUsage: (locationCode) => {
        return db.sequelize.query(
            // One grouped pass per table (t_expense.expense_id has no index, so a
            // correlated COUNT per expense would scan t_expense once per row)
            `SELECT me.Expense_id AS expense_id, me.Expense_name AS expense_name,
                    me.Expense_default_amt AS default_amt,
                    COALESCE(u.cnt, 0) AS usage_count
             FROM m_expense me
             LEFT JOIN (
                 SELECT expense_id, COUNT(*) AS cnt FROM (
                     SELECT expense_id FROM t_expense
                     UNION ALL
                     SELECT expense_id FROM t_expense_deleted
                 ) x GROUP BY expense_id
             ) u ON u.expense_id = me.Expense_id
             WHERE me.location_code = :locationCode
             ORDER BY me.Expense_name`,
            { replacements: { locationCode }, type: QueryTypes.SELECT }
        );
    },

    findExpenseById: async (expenseId, locationCode) => {
        const [row] = await db.sequelize.query(
            `SELECT Expense_id AS expense_id, Expense_name AS expense_name, Expense_default_amt AS default_amt
             FROM m_expense WHERE Expense_id = :expenseId AND location_code = :locationCode`,
            { replacements: { expenseId, locationCode }, type: QueryTypes.SELECT }
        );
        return row || null;
    },

    getUsageCount: async (expenseId) => {
        const [row] = await db.sequelize.query(
            `SELECT (SELECT COUNT(*) FROM t_expense WHERE expense_id = :expenseId)
                  + (SELECT COUNT(*) FROM t_expense_deleted WHERE expense_id = :expenseId) AS cnt`,
            { replacements: { expenseId }, type: QueryTypes.SELECT }
        );
        return Number(row.cnt);
    },

    // Case-insensitive name clash at the location, optionally ignoring one id (for edits)
    nameExists: async (locationCode, name, excludeId = null) => {
        const [row] = await db.sequelize.query(
            `SELECT 1 AS found FROM m_expense
             WHERE location_code = :locationCode AND UPPER(TRIM(Expense_name)) = UPPER(TRIM(:name))
               AND (:excludeId IS NULL OR Expense_id <> :excludeId)
             LIMIT 1`,
            { replacements: { locationCode, name, excludeId }, type: QueryTypes.SELECT }
        );
        return !!row;
    },

    createExpense: async (locationCode, name, defaultAmt, user) => {
        const [insertId] = await db.sequelize.query(
            `INSERT INTO m_expense (Expense_name, location_code, Expense_default_amt, created_by, updated_by, creation_date, updation_date)
             VALUES (:name, :locationCode, :defaultAmt, :user, :user, NOW(), NOW())`,
            { replacements: { name, locationCode, defaultAmt, user }, type: QueryTypes.INSERT }
        );
        return insertId;
    },

    updateExpense: (expenseId, locationCode, name, defaultAmt, user) => {
        return db.sequelize.query(
            `UPDATE m_expense SET Expense_name = :name, Expense_default_amt = :defaultAmt, updated_by = :user
             WHERE Expense_id = :expenseId AND location_code = :locationCode`,
            { replacements: { expenseId, locationCode, name, defaultAmt, user }, type: QueryTypes.UPDATE }
        );
    },

    // Only ever called after getUsageCount() === 0; the NOT EXISTS guards repeat
    // that check in the same statement so a shift saved in between can't be orphaned.
    deleteUnusedExpense: async (expenseId, locationCode) => {
        // BULKDELETE (not DELETE) makes Sequelize 5 return the affected row count
        return db.sequelize.query(
            `DELETE FROM m_expense
             WHERE Expense_id = :expenseId AND location_code = :locationCode
               AND NOT EXISTS (SELECT 1 FROM t_expense WHERE expense_id = :expenseId)
               AND NOT EXISTS (SELECT 1 FROM t_expense_deleted WHERE expense_id = :expenseId)`,
            { replacements: { expenseId, locationCode }, type: QueryTypes.BULKDELETE }
        );
    },

    findExpenses: (locationCode) => {
        if (locationCode) {
            return Expense.findAll({
                where: {'location_code': locationCode},
                order: [Sequelize.literal('Expense_id ASC')],
            });
        } else {
            return Expense.findAll({
                order: [Sequelize.literal('Expense_id ASC')]
            });
        }
    }
};