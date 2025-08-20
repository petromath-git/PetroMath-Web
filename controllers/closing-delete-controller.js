const TxnWriteDao = require("../dao/txn-write-dao");

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
    deleteClosingRecord: (req, res, next) => {
        TxnWriteDao.deleteClosing(req.query.id).then(() => {
            // TODO: fix the data check later, not finding proper documentation on it.
            res.status(200).send({message: 'The closing record is deleted successfully.'});
        }).error((err) => {
            res.status(500).send({error: 'Error while deleting the closing record.'});
        });
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
const txnDeleteCashSalePromise = (saleId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteCashSaleById(saleId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting cash sale " + err.toString());
            resolve({error: err.toString()});
        });
    });
}


// Add new flow: Delete one credit sale data
const txnDeleteCreditSalePromise = (saleId) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.deleteCreditSaleById(saleId)
            .then(status => {
                if (status > 0) {
                    resolve({message: 'Data deletion success.'});
                } else {
                    resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
            console.error("Error while deleting credit sale " + err.toString());
            resolve({error: err.toString()});
        });
    });
}


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