const TxnWriteDao = require("../dao/txn-write-dao");
const TxnReadDao = require("../dao/txn-read-dao");

// New/edit flow : This controller takes care to bulk insert/update rows in txn tables.

module.exports = {
    txnWriteClosingPromise: (closingData) => {
        return txnWriteClosingPromise(closingData);
    },
    txnWriteReadingPromise: (readingDataArr) => {
        return txnWriteReadingPromise(readingDataArr);
    },
    txnWrite2TSalesPromise: (saleDataArr) => {
        return txnWrite2TSalesPromise(saleDataArr);
    },
    txnWriteCashSalesPromise: (saleDataArr) => {
        return txnWriteCashSalesPromise(saleDataArr);
    },
    txnWriteCreditSalesPromise: (saleDataArr) => {
        return txnWriteCreditSalesPromise(saleDataArr);
    },
    txnWriteExpensesPromise: (expenseArr) => {
        return txnWriteExpensesPromise(expenseArr);
    },
    txnWriteDenomsPromise: (denomArr) => {
        return txnWriteDenomsPromise(denomArr);
    },
    getExcessShortage: (closingId) => {
        return getExcessShortage(closingId);
    },
    txnWriteAttendancePromise: (attendanceDataArr) => {
        return txnWriteAttendancePromise(attendanceDataArr);
    }
}


// Add new flow: Add closing data
const txnWriteClosingPromise = (closingData) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveClosingData(closingData)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving closing " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add reading data
const txnWriteReadingPromise = (readingDataArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveReadings(readingDataArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving readings " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: 2T Sale data
const txnWrite2TSalesPromise = (saleDataArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.save2TSales(saleDataArr)
            .then(data => {
                resolve(data);
            }).catch((err)  =>{
            console.error("Error while saving 2T sales " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add cash sales data
const txnWriteCashSalesPromise = (cashSalesArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveCashSales(cashSalesArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving cash sales " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add credit sales data
const txnWriteCreditSalesPromise = (creditSalesArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveCreditSales(creditSalesArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving credit sales " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add expenses data
const txnWriteExpensesPromise = (expenseArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveExpenses(expenseArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving expenses " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add denoms data
const txnWriteDenomsPromise = (denomArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveDenoms(denomArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving denoms " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

const getExcessShortage = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getExcessShortage(closingId).then(data => {
            resolve(data);
        }).catch((err) => {
            console.error("Error while calculating excess shortage " + err.toString());
            resolve({error: err.toString()});
        });
    });
}

// Add new flow: Add Attendance data
const txnWriteAttendancePromise = (attendanceDataArr) => {
    return new Promise((resolve, reject) => {
        TxnWriteDao.saveAttendance(attendanceDataArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving attendance " + err.toString());
            resolve({error: err.toString()});
        });
    });
}
