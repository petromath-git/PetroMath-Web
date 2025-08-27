
const db = require("../db/db-connection");
const TxnClosing = db.txn_closing;
const TxnReading = db.txn_reading;
const Txn2TOil = db.txn_2t_oil;
const TxnCashSales = db.txn_cashsales;
const TxnCreditSales = db.txn_credits;
const TxnExpenses = db.txn_expense;
const TxnDenoms = db.txn_denom;
const TxnAttendance = db.txn_attendance;
const TxnDigitalSales = db.txn_digital_sales;

module.exports = {
    saveClosingData: (data) => {
        const closingTxn = TxnClosing.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["closer_id", "cashier_id", "closing_date",
                "close_reading_time","cash", "notes", "updated_by", "updation_date"]
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
    updateClosingReadingTime: (closingId, readingTime, updatedBy) => {
    return TxnClosing.update(
        { 
            close_reading_time: readingTime,
            updated_by: updatedBy,
            updation_date: new Date()
        },
        { 
            where: { closing_id: closingId }
        }
    );
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
            updateOnDuplicate: ["bill_no", "creditlist_id","vehicle_id",
                "product_id", "price", "price_discount", "qty", "amount", "notes", "updated_by", "updation_date"]});
        return salesTxn;
    },
    saveDigitalSales: (data) => {
    const salesTxn = TxnDigitalSales.bulkCreate(data, {
        returning: true,
        updateOnDuplicate: ["vendor_id", "amount", "transaction_date", "notes", "updated_by", "updation_date"]
    });
    return salesTxn;
    },
    deleteCreditSaleById: (saleId) => {
        const saleTxn = TxnCreditSales.destroy({ where: { tcredit_id: saleId } });
        return saleTxn;
    },
    deleteDigitalSaleById: (digitalSalesId) => {
    const salesTxn = TxnDigitalSales.destroy({ where: { digital_sales_id: digitalSalesId } });
    return salesTxn;
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
    finishClosing: async (closingId) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            // Step 1: Calculate excess/shortage using the stored procedure
            const shortageResult = await db.sequelize.query(`
                SELECT calculate_exshortage(?) as excess_shortage
            `, {
                replacements: [closingId],
                type: db.Sequelize.QueryTypes.SELECT,
                transaction
            });
    
            const excessShortage = shortageResult[0]?.excess_shortage || 0;
    
            // Step 2: Update closing status and populate ex_short field
            const closingTxn = await TxnClosing.update(
                { 
                    closing_status: 'CLOSED',
                    ex_short: excessShortage,
                    updated_by: 'system', // or you can pass this as parameter
                    updation_date: new Date()
                },
                { 
                    where: { closing_id: closingId },
                    transaction 
                }
            );
    
            await transaction.commit();
            return closingTxn;
    
        } catch (error) {
            await transaction.rollback();
            console.error('Error in finishClosing:', error);
            throw error;
        }
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
