
const db = require("../db/db-connection");
const TxnClosing = db.txn_closing;
const TxnReading = db.txn_reading;
const Txn2TOil = db.txn_2t_oil;
const TxnCashSales = db.txn_cashsales;
const TxnCreditSales = db.txn_credits;
const TxnExpenses = db.txn_expense;
const TxnDenoms = db.txn_denom;
const TxnAttendance = db.txn_attendance;

module.exports = {
    saveClosingData: (data) => {
        const closingTxn = TxnClosing.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["closer_id", "cashier_id", "closing_date",
                "cash", "notes", "updated_by", "updation_date"]
        });
        return closingTxn;
    },
    saveReadings: (data) => {
        const readingTxn = TxnReading.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["opening_reading", "closing_reading",
            "pump_id", "price", "testing", "updated_by", "updation_date"]
        });
        return readingTxn;
    },
    deleteReadingById: (readingId) => {
        const readingTxn = TxnReading.destroy({ where: { reading_id: readingId } });
        return readingTxn;
    },
    save2TSales: (data) => {
        const saleTxn = Txn2TOil.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["given_qty", "returned_qty",
                "price", "updated_by", "updation_date"]
        });
        return saleTxn;
    },
    saveCashSales: (data) => {
        const salesTxn = TxnCashSales.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["Bill_no", "product_id",
                "price", "price_discount", "qty", "amount", "notes", "updated_by", "updation_date"]});
        return salesTxn;
    },
    deleteCashSaleById: (saleId) => {
        const saleTxn = TxnCashSales.destroy({ where: { cashsales_id: saleId } });
        return saleTxn;
    },
    saveCreditSales: (data) => {
        const salesTxn = TxnCreditSales.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["bill_no", "creditlist_id",
                "product_id", "price", "price_discount", "qty", "amount", "notes", "updated_by", "updation_date"]});
        return salesTxn;
    },
    deleteCreditSaleById: (saleId) => {
        const saleTxn = TxnCreditSales.destroy({ where: { tcredit_id: saleId } });
        return saleTxn;
    },
    saveExpenses: (data) => {
        const expenseTxn = TxnExpenses.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["expense_id", "amount", "notes", "updated_by", "updation_date"]});
        return expenseTxn;
    },
    deleteExpenseById: (expenseId) => {
        const expenseTxn = TxnExpenses.destroy({ where: { texpense_id: expenseId } });
        return expenseTxn;
    },
    saveDenoms: (data) => {
        const denomTxn = TxnDenoms.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["denomcount", "updated_by", "updation_date"]});
        return denomTxn;
    },
    finishClosing: (closingId) => {
        const closingTxn = TxnClosing.update(
            { closing_status: 'CLOSED' },
            { where: { closing_id: closingId } }
        );
        return closingTxn;
    },
    deleteClosing: (closingId) => {
        const closingTxn = db.sequelize.query(
            'CALL delete_closing(' + closingId + ');', null, { raw: true }
        );
        return closingTxn;
    },

    saveAttendance: (data) => {
        //console.log("data", data);
        const attendanceTxn = TxnAttendance.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["person_id", "shift_type", "in_time","out_time",
            "in_date", "out_date", "notes", "updated_by", "updation_date"]
        });
        return attendanceTxn;
    },

    deleteAttendanceById: (attendanceId) => {
        const attendanceTxn = TxnAttendance.destroy({ where: { tattendance_id: attendanceId } });
        return attendanceTxn;
    },
}
