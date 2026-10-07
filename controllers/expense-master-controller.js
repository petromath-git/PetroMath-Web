// controllers/expense-master-controller.js — cashier expense master (m_expense)
const ExpenseDao = require('../dao/expense-dao');

const MIN_DEFAULT_AMT = 0;
const MAX_DEFAULT_AMT = 10000;
const MAX_NAME_LENGTH = 100;

const normaliseName = (v) => String(v || '').trim().replace(/\s+/g, ' ');

// Returns { name, defaultAmt } or { error }
function validateInput(body) {
    const name = normaliseName(body.expense_name);
    if (!name) return { error: 'Expense name is required.' };
    if (name.length > MAX_NAME_LENGTH) return { error: `Expense name must be ${MAX_NAME_LENGTH} characters or less.` };

    const raw = body.default_amt === undefined || body.default_amt === null ? '' : String(body.default_amt).trim();
    const defaultAmt = raw === '' ? 0 : Number(raw);
    // m_expense.Expense_default_amt is an INT column
    if (!Number.isInteger(defaultAmt) || defaultAmt < MIN_DEFAULT_AMT || defaultAmt > MAX_DEFAULT_AMT) {
        return { error: `Default amount must be a whole number between ${MIN_DEFAULT_AMT} and ${MAX_DEFAULT_AMT}.` };
    }
    return { name, defaultAmt };
}

module.exports = {
    getExpenseMasterPage: async (req, res, next) => {
        try {
            const expenses = await ExpenseDao.findExpensesWithUsage(req.user.location_code);
            res.render('expense-master', {
                title: 'Cashier Expenses',
                user: req.user,
                expenses: expenses.map(e => ({
                    ...e,
                    usage_count: Number(e.usage_count),
                    is_protected: ExpenseDao.isProtectedName(e.expense_name),
                })),
                minDefaultAmt: MIN_DEFAULT_AMT,
                maxDefaultAmt: MAX_DEFAULT_AMT,
                maxNameLength: MAX_NAME_LENGTH,
            });
        } catch (e) {
            next(e);
        }
    },

    createExpense: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const input = validateInput(req.body);
            if (input.error) return res.status(400).json({ success: false, error: input.error });
            if (await ExpenseDao.nameExists(locationCode, input.name)) {
                return res.status(400).json({ success: false, error: `"${input.name}" already exists at this location.` });
            }
            const id = await ExpenseDao.createExpense(locationCode, input.name, input.defaultAmt, req.user.Person_id);
            res.json({ success: true, expense_id: id });
        } catch (e) {
            console.error('Error creating expense:', e);
            res.status(500).json({ success: false, error: 'Error creating expense.' });
        }
    },

    updateExpense: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const expenseId = parseInt(req.params.id, 10);
            const existing = await ExpenseDao.findExpenseById(expenseId, locationCode);
            if (!existing) return res.status(404).json({ success: false, error: 'Expense not found.' });

            const input = validateInput(req.body);
            if (input.error) return res.status(400).json({ success: false, error: input.error });

            // Compare normalised so stray spaces in an old name don't count as a rename
            const renamed = input.name !== normaliseName(existing.expense_name);
            if (!renamed) input.name = existing.expense_name;
            if (renamed) {
                // Shift closing keys behaviour off these names (see ExpenseDao.PROTECTED_EXPENSE_NAMES)
                if (ExpenseDao.isProtectedName(existing.expense_name)) {
                    return res.status(400).json({ success: false, error: `"${existing.expense_name}" is used by shift closing and can't be renamed. You can still change its default amount.` });
                }
                if (ExpenseDao.isProtectedName(input.name)) {
                    return res.status(400).json({ success: false, error: `"${input.name}" is a reserved expense name.` });
                }
                if (await ExpenseDao.nameExists(locationCode, input.name, expenseId)) {
                    return res.status(400).json({ success: false, error: `"${input.name}" already exists at this location.` });
                }
            }

            await ExpenseDao.updateExpense(expenseId, locationCode, input.name, input.defaultAmt, req.user.Person_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Error updating expense:', e);
            res.status(500).json({ success: false, error: 'Error updating expense.' });
        }
    },

    deleteExpense: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const expenseId = parseInt(req.params.id, 10);
            const existing = await ExpenseDao.findExpenseById(expenseId, locationCode);
            if (!existing) return res.status(404).json({ success: false, error: 'Expense not found.' });
            if (ExpenseDao.isProtectedName(existing.expense_name)) {
                return res.status(400).json({ success: false, error: `"${existing.expense_name}" is used by shift closing and can't be deleted.` });
            }
            const usage = await ExpenseDao.getUsageCount(expenseId);
            if (usage > 0) {
                return res.status(400).json({ success: false, error: `"${existing.expense_name}" is used in ${usage} shift entr${usage === 1 ? 'y' : 'ies'} and can't be deleted.` });
            }
            const deleted = await ExpenseDao.deleteUnusedExpense(expenseId, locationCode);
            if (!deleted) {
                return res.status(409).json({ success: false, error: `"${existing.expense_name}" was just used in a shift and can't be deleted.` });
            }
            res.json({ success: true });
        } catch (e) {
            console.error('Error deleting expense:', e);
            res.status(500).json({ success: false, error: 'Error deleting expense.' });
        }
    },
};
