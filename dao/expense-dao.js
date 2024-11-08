const db = require("../db/db-connection");
const Expense = db.expense;
const Sequelize = require("sequelize");

module.exports = {
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