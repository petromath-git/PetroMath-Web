const TxnReadDao = require("../dao/txn-read-dao");
const ProductDao = require("../dao/product-dao");
const PumpDao = require("../dao/pump-dao");
const CreditDao = require("../dao/credits-dao");
const utils = require("../utils/app-utils");
const appCache = require("../utils/app-cache");
const config = require("../config/app-config");

// New/edit flow: Common functions related to get master / txn table related data.

module.exports = {
    getNamesPromise: (closerId, cashierId) => {
        return getNamesPromise(closerId, cashierId);
    },
    pumpDataPromise: (locationCode) => {
        return pumpDataPromise(locationCode);
    },
    txnCashSalesPromise: (closingId) => {
        return txnCashSalesPromise(closingId);
    },
    txnCreditsPromise: (closingId) => {
        return txnCreditsPromise(closingId);
    },
    txnDenominationPromise: (closingId) => {
        return txnDenominationPromise(closingId);
    },
    creditCompanyDataPromise: (locationCode) => {
        return creditCompanyDataPromise(locationCode);
    },
    suspenseDataPromise: (locationCode) => {
        return suspenseDataPromise(locationCode);
    },
    txnAttendanceDataPromise: (closingId) => {
        return txnAttendanceDataPromise(closingId);
    },
}

// Used as part of txnClosingPromise(new/edit flow) to do cashier,closer ids to person's name conversion
const getNamesPromise = (closerId, cashierId) => {
    return new Promise((resolve, reject) => {
        const personData = appCache.getPersonCache();
        const closerName = utils.getPersonName(closerId, personData);
        const cashierName = utils.getPersonName(cashierId, personData);
        // TODO: debug this issue later, the names are undefined.
        resolve({closerName: closerName, cashierName: cashierName});
    });
}

// Add new flow: Get pumps data
const pumpDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let pumps = [];
        PumpDao.findPumps(locationCode)
            .then(data => {
                data.forEach((pump) => {
                    pumps.push({
                        pumpId: pump.pump_id,
                        productCode: pump.product_code,
                        pumpCode: pump.pump_code,
                        pumpClosing: pump.opening_reading,
                        pumpOpening: pump.opening_reading,
                        pumpTesting: 0,
                        sale: 0});
                });
                resolve(pumps);
            });
    });
}

// Show/edit closing records flow: Getting txn cash sales data based on closing id
const txnCashSalesPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getCashSalesByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let salesData = [], productIds = [];
                    data.forEach((sale) => {
                        productIds.push(sale.product_id);
                    });
                    getProductNamesPromise(productIds).then((result) => {
                        data.forEach((sale) => {
                            salesData.push({
                                saleId: sale.cashsales_id,
                                billNo: sale.Bill_no,
                                productId: sale.product_id,
                                price: sale.price,
                                priceDiscount : sale.price_discount,
                                qty: sale.qty,
                                amount: sale.amount,
                                notes: sale.notes,
                            });
                        });
                        resolve(salesData);
                    });
                } else {
                    resolve([]);
                }
            });
    });
}

// Used as part of txnCashSalesPromise, txnCreditsPromise to do product id to product name conversion
const getProductNamesPromise = (productIds) => {
    return new Promise((resolve, reject) => {
        resolve(ProductDao.findProductNames(productIds));
    });
}

// Show closing records flow: Getting txn credits data based on closing id
const txnCreditsPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getCreditsByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let credits = [], productIds = [], creditIds = [];
                    data.forEach((read) => {
                        creditIds.push(read.creditlist_id);
                        productIds.push(read.product_id);
                    });
                    Promise.allSettled([getProductNamesPromise(productIds), getCreditDetailsPromise(creditIds)])
                        .then((result) => {
                            const productData = result[0].value;
                            const creditListData = result[1].value;
                            data.forEach((credit) => {
                                credits.push({
                                    tCreditId: credit.tcredit_id,
                                    billNo: credit.bill_no,
                                    creditListId: credit.creditlist_id,
                                    productId: credit.product_id,
                                    creditType: utils.getCreditType(credit.creditlist_id, creditListData),
                                    companyName: utils.getCompanyName(credit.creditlist_id, creditListData),
                                    productName: utils.getProductName(credit.product_id, productData),
                                    price: credit.price,
                                    priceDiscount: credit.price_discount,
                                    qty: credit.qty,
                                    amount: credit.amount,
                                    notes: credit.notes
                                });
                            });
                            resolve(credits);
                        });
                } else {
                    resolve([]);
                }
            });
    });
}

// Used as part of txnCreditsPromise to do credit id to company name conversion
const getCreditDetailsPromise = (creditIds) => {
    return new Promise((resolve, reject) => {
        resolve(CreditDao.findCreditDetails(creditIds));
    });
}

// Add/edit new flow: Get credit company data
const creditCompanyDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let companies = [];
        CreditDao.findCredits(locationCode)
            .then(data => {
                data.forEach((credit) => {
                    companies.push({creditorId: credit.creditlist_id, creditorName: credit.Company_Name});
                });
                resolve(companies);
            });
    });
}

// Add/edit new flow: Get suspense data
const suspenseDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let suspenses = [];
        CreditDao.findSuspenses(locationCode)
            .then(data => {
                data.forEach((credit) => {
                    suspenses.push({creditorId: credit.creditlist_id, creditorName: credit.Company_Name});
                });
                resolve(suspenses);
            });
    });
}

// Show closing records flow: Getting txn denominations data based on closing id
const txnDenominationPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDenomsByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let denominations = [];
                    config.APP_CONFIGS.denominationValues.forEach( (keyValue) => {
                        const denomination = getDenomTxn(keyValue.id, data);
                        if(denomination) {
                            denominations.push({
                                denomTxnId: denomination.denom_id,
                                id: denomination.denomination,
                                label: keyValue.label,
                                denominationCnt: denomination.denomcount
                            });
                        } else {
                            denominations.push({
                                id: keyValue.id,
                                label: keyValue.label,
                            });
                        }
                    });
                    resolve(denominations);
                } else {
                    resolve(config.APP_CONFIGS.denominationValues);
                }
            });
    });
}

function getDenomTxn(id, denominationTxn) {
    let returnTxn = null;
    denominationTxn.forEach((denomination) => {
        if(denomination.denomination === id) {
            returnTxn = denomination;
        }
    });
    return returnTxn;
}

const txnAttendanceDataPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getAttendanceByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let attendanceData = [] ;
                    data.forEach((transaction) => {
                        attendanceData.push({
                            tAttendanceId : transaction.tattendance_id,
                            closingId : transaction.closing_id,
                            personId : transaction.person_id,
                            shiftType: transaction.shift_type,
                            inDateTime:transaction.in_date+"T"+ transaction.in_time,
                            outDateTime: transaction.out_date+"T"+transaction.out_time,
                            notes: transaction.notes
                        });     
                        
                    });         
                    resolve(attendanceData);
                } else {
                    resolve([]);
                }
            });
    });
}

