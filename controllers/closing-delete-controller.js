const TxnWriteDao = require("../dao/txn-write-dao");
const db = require("../db/db-connection");

// New/edit flow : This controller takes care to delete txn table row.

module.exports = {
    txnDeleteReadingPromise: (readingId) => {
        return txnDeleteReadingPromise(readingId);
    },
    txnDeleteCashSalePromise: (saleId) => {
        return txnDeleteCashSalePromise(saleId);
    },
    txnDeleteCreditSalePromise: (saleId) => {
        return txnDeleteCreditSalePromise(saleId);
    },
    txnDeleteExpensePromise: (expenseId) => {
        return txnDeleteExpensePromise(expenseId);
    },
    deleteClosingRecord: async (req, res, next) => {
        const closingId = req.query.id;
        const username = req.user && req.user.username;

        try {
            // Guard: only DRAFT shifts may be deleted from UI
            const [closing] = await db.sequelize.query(
                `SELECT closing_status FROM t_closing WHERE closing_id = :closingId`,
                { replacements: { closingId }, type: db.sequelize.QueryTypes.SELECT }
            );
            if (!closing) {
                return res.status(404).send({ error: 'Shift not found.' });
            }
            if (closing.closing_status !== 'DRAFT') {
                return res.status(400).send({
                    error: `Cannot delete a shift in '${closing.closing_status}' status. Only DRAFT shifts can be deleted.`
                });
            }

            // Check if bills exist for this shift
            const billsExist = await TxnWriteDao.checkBillsExistForShift(closingId);
            if (billsExist) {
                return res.status(400).send({
                    error: 'Cannot delete shift - billing records exist for this shift'
                });
            }

            await TxnWriteDao.deleteClosing(closingId, username);
            res.status(200).send({ message: 'The closing record is deleted successfully.' });

        } catch (err) {
            console.error('Error while deleting closing record:', err);
            res.status(500).send({ error: 'Error while deleting the closing record.' });
        }
    },

    getDeletedClosings: async (req, res, next) => {
        try {
            const locationCode = req.user && req.user.location_code;
            const records = await TxnWriteDao.getDeletedClosings(locationCode);
            res.render('deleted-closings', {
                title: 'Deleted Shifts',
                records,
                user: req.user
            });
        } catch (err) {
            console.error('Error fetching deleted closings:', err);
            res.status(500).send({ error: 'Error fetching deleted shifts.' });
        }
    },

    restoreClosing: async (req, res, next) => {
        const deletedRecordId = req.query.id;
        const username = req.user && req.user.username;

        try {
            await TxnWriteDao.restoreClosing(deletedRecordId, username);
            res.status(200).send({ message: 'Shift restored successfully.' });
        } catch (err) {
            console.error('Error restoring closing:', err);
            const spMessage = err && err.parent && err.parent.sqlMessage;
            res.status(500).send({ error: spMessage || 'Error restoring the shift.' });
        }
    },

    txnDeleteAttendancePromise: (attendanceId) => {
        return txnDeleteAttendancePromise(attendanceId);
    },
    txnDeleteDigitalSalePromise: (digitalSalesId) => {
    return txnDeleteDigitalSalePromise(digitalSalesId);
    },
}

// Add new flow: Delete one reading data
const txnDeleteReadingPromise = (readingId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteReadingById(readingId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting readings " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Delete one cash sale data
const txnDeleteCashSalePromise = async (saleId) => {
    try {
        // Check if this cash sale has a bill_id
        const hasBill = await TxnWriteDao.checkCashSaleHasBill(saleId);
        
        if (hasBill) {
            return { error: 'Cannot delete - this record is linked to a bill' };
        }
        
        // Proceed with deletion
        const status = await TxnWriteDao.deleteCashSaleById(saleId);
        
        if (status > 0) {
            return { message: 'Data deletion success.' };
        } else {
            return { error: 'Data deletion failed.' };
        }
    } catch (err) {
        console.error("Error while deleting cash sale " + err.toString());
        return { error: err.toString() };
    }
};

// Add new flow: Delete one credit sale data
const txnDeleteCreditSalePromise = async (saleId) => {
    try {
        // Check if this credit sale has a bill_id
        const hasBill = await TxnWriteDao.checkCreditSaleHasBill(saleId);
        
        if (hasBill) {
            return { error: 'Cannot delete - this record is linked to a bill' };
        }
        
        // Proceed with deletion
        const status = await TxnWriteDao.deleteCreditSaleById(saleId);
        
        if (status > 0) {
            return { message: 'Data deletion success.' };
        } else {
            return { error: 'Data deletion failed.' };
        }
    } catch (err) {
        console.error("Error while deleting credit sale " + err.toString());
        return { error: err.toString() };
    }
};


// Add new flow: Delete one expense data
const txnDeleteExpensePromise = (expenseId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteExpenseById(expenseId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting expense " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Delete one attendance data
const txnDeleteAttendancePromise = (attendanceId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteAttendanceById(attendanceId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting attendance " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Delete one digital sale data
const txnDeleteDigitalSalePromise = (digitalSalesId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteDigitalSaleById(digitalSalesId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting digital sale " + err.toString());
            resolve({error: err.toString()});
        });
    });
}