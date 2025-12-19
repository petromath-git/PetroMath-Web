
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
    // Validate all readings before saving to database
    const validationErrors = [];
    
    data.forEach((reading, index) => {
        const closing = parseFloat(reading.closing_reading) || 0;
        const opening = parseFloat(reading.opening_reading) || 0;
        const testing = parseFloat(reading.testing) || 0;
        const pumpId = reading.pump_id;
        
      
               
        // Validation 1: Closing must be >= Opening
        if (closing < opening) {
            validationErrors.push({
                pumpId: pumpId,
                field: 'closing_reading',
                error: `Pump ${pumpId}: Closing reading (${closing}) cannot be less than opening reading (${opening})`
            });
        }
        
        // Validation 2: Net sales (closing - opening - testing) must be >= 0
        const netSales = closing - opening - testing;
        if (netSales < 0) {
            const grossSales = closing - opening;
            validationErrors.push({
                pumpId: pumpId,
                field: 'testing',
                error: `Pump ${pumpId}: Testing value (${testing}) is too high. Gross sales is only ${grossSales}. Net sales cannot be negative.`
            });
        }
    });
    
    // If validation errors exist, reject the promise with detailed error
    if (validationErrors.length > 0) {
        const errorMessage = validationErrors.map(e => e.error).join('; ');
        return Promise.reject(new Error(`Reading validation failed: ${errorMessage}`));
    }
    
    // If validation passes, proceed with database save
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
            "product_id", "price", "price_discount", "qty", "amount", "notes", 
            "vehicle_number", "indent_number", "settlement_date", "recon_id", "bill_id",
            "odometer_reading", "updated_by", "updation_date"]});
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
        // STEP 0: Check if closing is already closed to prevent duplicate closing
        const existingClosing = await db.sequelize.query(`
            SELECT closing_status 
            FROM t_closing 
            WHERE closing_id = :closingId
        `, {
            replacements: { closingId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction
        });

        const closing = existingClosing[0];

        if (!closing) {
            // No changes made, just return error (transaction will auto-cleanup)
            return { error: 'Closing record not found' };
        }

        if (closing.closing_status === 'CLOSED') {
            // No changes made, just return error (transaction will auto-cleanup)
            return { error: 'This shift is already closed. Cannot close again.' };
        }

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
                updated_by: 'system',
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
        // Only rollback if transaction hasn't finished
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error('Error in finishClosing:', error);
        return { error: error.message || 'Error closing shift' };
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
    checkBillsExistForShift: async (closingId) => {
        const result = await db.sequelize.query(
            `SELECT COUNT(*) as bill_count 
            FROM t_bills 
            WHERE closing_id = ?`,
            {
                replacements: [closingId],
                type: db.Sequelize.QueryTypes.SELECT
            }
        );
        
        return result[0].bill_count > 0;
    },
    checkCashSaleHasBill: async (saleId) => {
        const result = await db.sequelize.query(
            `SELECT bill_id 
            FROM t_cashsales 
            WHERE cashsales_id = ?`,
            {
                replacements: [saleId],
                type: db.Sequelize.QueryTypes.SELECT
            }
        );
        
        return result.length > 0 && result[0].bill_id !== null;
    },

    checkCreditSaleHasBill: async (saleId) => {
        const result = await db.sequelize.query(
            `SELECT bill_id 
            FROM t_credits 
            WHERE tcredit_id = ?`,
            {
                replacements: [saleId],
                type: db.Sequelize.QueryTypes.SELECT
            }
        );
        
        return result.length > 0 && result[0].bill_id !== null;
    },

    

// Check if shift can be reopened (no cashflow_id linked)
canReopenShift: async (closingId, locationCode) => {
    const result = await db.sequelize.query(
        `SELECT 
            closing_id,
            closing_status,
            cashflow_id
        FROM t_closing
        WHERE closing_id = :closingId
        AND location_code = :locationCode
        AND closing_status = 'CLOSED'`,
        {
            replacements: { closingId, locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        }
    );
    
    if (result.length === 0) {
        return { canReopen: false, reason: 'Shift not found or not closed' };
    }
    
    if (result[0].cashflow_id !== null) {
        return { canReopen: false, reason: 'Shift is linked to a cashflow and cannot be reopened' };
    }
    
    return { canReopen: true };
},

// Reopen shift (update status to DRAFT)
reopenShift: async (closingId, locationCode, userId) => {
    const result = await db.sequelize.query(
        `UPDATE t_closing 
        SET closing_status = 'DRAFT',
            updated_by = :userId,
            updation_date = NOW()
        WHERE closing_id = :closingId
        AND location_code = :locationCode
        AND closing_status = 'CLOSED'
        AND cashflow_id IS NULL`,
        {
            replacements: { closingId, locationCode, userId },
            type: db.Sequelize.QueryTypes.UPDATE
        }
    );
    
    return result[1]; // returns number of rows affected
},
}
