//txn-common-controller.js

const TxnReadDao = require("../dao/txn-read-dao");
const ProductDao = require("../dao/product-dao");
const PumpDao = require("../dao/pump-dao");
const CreditDao = require("../dao/credits-dao");
const utils = require("../utils/app-utils");
const appCache = require("../utils/app-cache");
const config = require("../config/app-config");
const db = require("../db/db-connection");
const Sequelize = require("sequelize");

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
    txnDigitalSalesPromise: (closingId) => {
    return txnDigitalSalesPromise(closingId);
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
    shiftProductsPromise: (closingId) => {
        return shiftProductsPromise(closingId);
    }

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
// In txn-common-controller.js
const CreditVehicleDao = require("../dao/credit-vehicles-dao");

const txnCreditsPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getCreditsByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let credits = [], productIds = [], creditIds = [], vehicleIds = [];
                    data.forEach((read) => {
                        creditIds.push(read.creditlist_id);
                        productIds.push(read.product_id);
                        if (read.vehicle_id) {
                            vehicleIds.push(read.vehicle_id);
                        }
                    });
                    
                    Promise.allSettled([
                        getProductNamesPromise(productIds), 
                        getCreditDetailsPromise(creditIds),
                        vehicleIds.length > 0 ? CreditVehicleDao.findByVehicleIds(vehicleIds) : Promise.resolve([])
                    ])
                    .then((result) => {
                        const productData = result[0].value;
                        const creditListData = result[1].value;
                        const vehicleData = result[2].value || [];
                        
                        data.forEach((credit) => {
                            const vehicleInfo = vehicleData.find(v => v.vehicle_id === credit.vehicle_id);
                            
                            credits.push({
                                tCreditId: credit.tcredit_id,
                                billNo: credit.bill_no,
                                creditListId: credit.creditlist_id,
                                vehicleId: credit.vehicle_id,
                                productId: credit.product_id,
                                creditType: utils.getCreditType(credit.creditlist_id, creditListData),
                                companyName: utils.getCompanyName(credit.creditlist_id, creditListData),
                                productName: utils.getProductName(credit.product_id, productData),
                                price: credit.price,
                                priceDiscount: credit.price_discount,
                                qty: credit.qty,
                                amount: credit.amount,
                                notes: credit.notes,
                                odometerReading: credit.odometer_reading  // ADD THIS LINE
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
                    companies.push({creditorId: credit.creditlist_id, creditorName: credit.Company_Name, card_flag: credit.card_flag});
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

// Show closing records flow: Getting txn digital sales data based on closing id
const txnDigitalSalesPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        return TxnReadDao.getDigitalSalesByClosingId(closingId)
            .then(data => {
                if (data && data.length > 0) {
                    let digitalSalesData = [];
                    data.forEach((sale) => {
                        digitalSalesData.push({
                            digitalSalesId: sale.digital_sales_id,
                            vendorId: sale.vendor_id,
                            amount: sale.amount,
                            transactionDate: sale.transaction_date,
                            notes: sale.notes
                        });
                    });
                    resolve(digitalSalesData);
                } else {
                    resolve([]);
                }
            });
    });
}



const shiftProductsPromise = async (closingId) => {
    console.log('shiftProductsPromise called with:', closingId);
    
    if (!closingId) {
        console.log('No closingId provided, returning empty array');
        return [];
    }
    
    const query = `
        SELECT DISTINCT 
            p.product_code,
            mp.product_name,
            COALESCE(mp.rgb_color, '#f8f9fa') as rgb_color,
            SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) as total_amount
        FROM t_reading tr
        JOIN m_pump p ON tr.pump_id = p.pump_id  
        JOIN m_product mp ON p.product_code = mp.product_name 
        JOIN t_closing tc ON tr.closing_id = tc.closing_id
        WHERE tr.closing_id = :closingId
        AND mp.location_code = tc.location_code
        GROUP BY p.product_code, mp.product_name, mp.rgb_color
        ORDER BY p.product_code
    `;
    
    console.log('Executing query with closingId:', closingId);
    
    try {
        const result = await db.sequelize.query(query, {
            replacements: { closingId: closingId },
            type: Sequelize.QueryTypes.SELECT
        });
        
        
        console.log('Results length:', result ? result.length : 0);
        return result;
        
    } catch (error) {
        console.error('Database error:', error);
        throw error;
    }
};