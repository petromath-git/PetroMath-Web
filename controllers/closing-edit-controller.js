//closing-edit-controller.js

const TxnReadDao = require("../dao/txn-read-dao");
const TxnWriteDao = require("../dao/txn-write-dao");
const ProductDao = require("../dao/product-dao");
const txnController = require("./txn-common-controller");
const homeController = require("./home-controller");
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const security = require("../utils/app-security");
const CreditVehicleDao = require("../dao/credit-vehicles-dao");
const locationConfig = require('../utils/location-config');
const db = require('../db/db-connection');
// Edit flow: This controller takes care of all joins to get data for editing.

module.exports = {
    getDataToEdit: async  (req, res, next) => {
        const closingId = req.query.closingId;
        const locationCode = req.user.location_code;

        // NEW: Validate that the closing belongs to the user's location
    if (closingId) {
        try {
            
            const locationCheck = await db.sequelize.query(`
                SELECT location_code 
                FROM t_closing 
                WHERE closing_id = :closingId
            `, {
                replacements: { closingId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            
            if (locationCheck[0].location_code !== locationCode) {
                const error = {
                    status: 403,
                    stack: 'Unauthorized access attempt to closing from different location'
                };
                return res.status(403).render('error', {
                    user: req.user,
                    message: 'Unauthorized: You cannot access closing records from other locations',
                    error: error
                });
            }

            // Also update the "not found" case
            if (locationCheck.length === 0) {
                const error = {
                    status: 404,
                    stack: 'Closing record not found in database'
                };
                return res.status(404).render('error', {
                    user: req.user,
                    message: 'Closing record not found',
                    error: error
                });
            }
        } catch (error) {
            console.error('Error checking closing location:', error);
            return res.status(500).send('Internal server error');
        }
    }





        const maxBackDateDays =  Number(await locationConfig.getLocationConfigValue(
            locationCode, 
            'MAX_DAYS_ALLOWED_BACK_DATE_CLOSING', 
            config.APP_CONFIGS.maxDaysAllowedToGoBackForNewClosing
        ));

        const openingReadonlyConfig = await locationConfig.getLocationConfigValue(
        locationCode,
        'PUMP_OPENING_READING_READONLY',
        'N' // default value if not configured
         );

         const allowSecondaryPump = await locationConfig.getLocationConfigValue(
            locationCode,
            'ALLOW_SECONDARY_PUMP',
            'true' // default value
        );

         const digitalSalesBackdateDays = Number(await locationConfig.getLocationConfigValue(
            locationCode, 
            'DIGITAL_SALES_BACKDATE_DAYS', 
            2  // default 2 days
            ));     
        
            const digitalSalesFutureDays = Number(await locationConfig.getLocationConfigValue(
            locationCode, 
            'DIGITAL_SALES_FUTURE_DAYS', 
            0  // default 0 days
            ));    

        if(closingId) {
            Promise.allSettled([homeController.personDataPromise(locationCode),
                txnClosingPromise(closingId),
                homeController.productDataPromise(locationCode, config.PRODUCT_PUMPS),
                txnController.pumpDataPromise(locationCode),
                txnPumpAndReadingPromise(closingId, locationCode),
                txn2TSalePromise(closingId, locationCode),
                txnController.txnCashSalesPromise(closingId),
                txnController.txnCreditsPromise(closingId),
                txnController.creditCompanyDataPromise(locationCode),
                txnController.suspenseDataPromise(locationCode),
                homeController.expenseDataPromise(locationCode),
                txnExpensesPromise(closingId, locationCode),
                txnController.txnDenominationPromise(closingId),
                txnController.txnAttendanceDataPromise(closingId),
                homeController.personAttendanceDataPromise(locationCode),
                vehicleDataPromise(locationCode),
                homeController.pumpProductDataPromise(locationCode),
                txnController.txnDigitalSalesPromise(closingId),
                txnController.shiftProductsPromise(closingId)])
                .then((values) => {
                    res.render('edit-draft-closing', {
                        user: req.user,
                        config: config.APP_CONFIGS,
                        currentDate: utils.currentDate(),
                        minDateForNewClosing: utils.restrictToPastDate(maxBackDateDays),
                        isOpeningReadonly: openingReadonlyConfig === 'Y',
                        allowSecondaryPump: allowSecondaryPump === 'true',
                        digitalSalesBackdateDays: digitalSalesBackdateDays,
                        digitalSalesFutureDays: digitalSalesFutureDays,
                        cashiers: values[0].value.cashiers,
                        closingData: values[1].value,
                        productValues: values[2].value.products,
                        pumpInstances: values[3].value,
                        pumps:values[4].value.t_pump_readings,
                        product2TValues: values[5].value,
                        t_cashSales: values[6].value,
                        t_credits: values[7].value,
                        creditCompanyValues: values[8].value,
                        suspenseValues: values[9].value,
                        expenseValues: values[10].value.expenses,
                        t_expenses: values[11].value.t_expenses,
                        t_denoms: values[12].value,
                        attendanceData: values[13].value,
                        usersList: values[14].value.allUsers,
                        vehicleData: values[15].value,
                        pumpProductValues: values[16].value.products, 
                        digitalSalesData: values[17].value,
                        shiftProducts: values[18].value || []
                    });
                }).catch((err) => {
                console.warn("Error while getting data using promises " + err.toString());
                Promise.reject(err);
            });
        } else {
            res.render('home', {user: req.user});
        }
    },
    txnClosingPromise: (closingId) => {
        return txnClosingPromise(closingId);
    },
    closeData: async (req, res, next) => {
        try {
            const closingId = req.query.id;

            // First, validate that close_reading_time exists
                const closingDetails = await TxnReadDao.getClosingDetails(closingId);
                
                if (!closingDetails) {
                    return res.status(404).send({
                        error: 'Closing record not found.',
                        success: false
                    });
                }
                
                // Check if close_reading_time is missing
                if (!closingDetails.close_reading_time) {
                    return res.status(400).send({
                        error: 'Cannot finalize closing: Reading Time is required. Please go to the Reading tab and select when the pump readings were taken.',
                        success: false
                    });
                }




            
            // Call the updated async finishClosing function
            const data = await TxnWriteDao.finishClosing(closingId);
            
            // Check if update was successful (data is array [affectedRows])
            if (data && data[0] >= 1) {
                res.status(200).send({
                    message: 'The closing record is made final.',
                    success: true
                });
            } else {
                res.status(500).send({
                    error: 'Error while closing the record. No records updated.',
                    success: false
                });
            }
            
        } catch (error) {
            console.error('Error in closeData:', error);
            res.status(500).send({
                error: 'Error while closing the record: ' + error.message,
                success: false
            });
        }
    },
}

// Edit closing data flow: Getting txn closing data based on closing id
const txnClosingPromise = (closingId) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getClosingDetails(closingId)
            .then(data => {
                if (data) {
                    txnController.getNamesPromise(data.closer_id, data.cashier_id).then((result) => {
                        resolve({
                            closingId: data.closing_id, 
                            closingDate: data.closing_date_fmt1,
                            h_closingDate: data.closing_date_fmt2,
                            cash: data.cash, 
                            closerName: result.closerName, 
                            closerId: data.closer_id,
                            cashierName: result.cashierName, 
                            cashierId: data.cashier_id, 
                            notes: data.notes,
                            closingStatus: data.closing_status,
                            closeReadingTime: data.close_reading_time
                        });
                    });
                } else {
                    resolve({});
                }
            });
    });
}

// Used to join reading and pump data - assumes location code of pumps match that of the closing data.
const txnPumpAndReadingPromise = (closingId, locationCode) => {
    return new Promise((resolve, reject) => {
        ProductDao.findProducts(locationCode)
            .then((productData) => {
                TxnReadDao.getPumpAndReadingsByClosingId(closingId, locationCode)
                    .then(t_data => {
                        if (t_data && t_data.length > 0) {
                            let t_pumps = [];
                            t_data.forEach((t_pump) => {
                                let t_readings = t_pump.t_readings;
                                if (t_readings && t_readings.length > 0) {
                                    let t_pump_readings = [];
                                    t_readings.forEach((t_reading) => {
                                        t_pump_readings.push({
                                            readingId: t_reading.reading_id,
                                            pumpOpening: t_reading.opening_reading,
                                            pumpClosing: t_reading.closing_reading,
                                            pumpTesting: t_reading.testing,
                                            price: t_reading.price,
                                            pumpId: t_pump.pump_id,
                                            pumpCode: t_pump.pump_code,
                                        });
                                    });
                                    const product = utils.getProduct(t_data.pump_code, productData);
                                    t_pumps.push({
                                        pumpId: t_pump.pump_id,
                                        pumpCode: t_pump.pump_code,
                                        productCode: t_pump.product_code,
                                        productPrice: product.price,
                                        pumpOpening: t_pump.opening_reading,
                                        pumpReadings: t_pump_readings,
                                    });
                                } else {
                                    const product = utils.getProduct(t_data.pump_code, productData);
                                    t_pumps.push({
                                        pumpId: t_pump.pump_id,
                                        pumpCode: t_pump.pump_code,
                                        productCode: t_pump.product_code,
                                        productPrice: product.price,
                                        pumpOpening: t_pump.opening_reading,
                                        pumpReadings: [],
                                    });
                                }
                            });
                            resolve({t_pump_readings: t_pumps});
                        } else {
                            resolve({t_pump_readings: []});
                        }
                    });
            });
    });
}

// Used to join 2T product and 2T sale data.
const txn2TSalePromise= (closingId, locationCode) => {
    return new Promise((resolve, reject) => {
        ProductDao.findProducts(locationCode)
            .then((productData) => {
                const productMap = config.PRODUCT_DETAILS_MAPPING;
                TxnReadDao.get2TSalesByClosingId(closingId, locationCode)
                    .then(t_data => {
                        if (t_data && t_data.length > 0) {
                            let t_2toils = [];
                            t_data.forEach((t_2tSale) => {
                                let t_sale = t_2tSale.t_2toils;
                                const mapData = productMap.get(t_2tSale.product_name);
                                if (t_sale && t_sale.length > 0) {
                                    t_sale.forEach((sale) => {
                                        t_2toils.push({
                                            t2tOilId: sale.oil_id,
                                            productId: sale.product_id,
                                            price: sale.price,
                                            givenQty: sale.given_qty,
                                            returnedQty: sale.returned_qty,
                                            productAlias: mapData.tag,
                                            textName: mapData.tag,
                                            productPrice: sale.price,
                                            productName: t_2tSale.product_name
                                        });
                                    });
                                } else {
                                    const mapData = productMap.get(t_2tSale.product_name);
                                    t_2toils.push({
                                        productId: t_2tSale.product_id,
                                        productAlias: mapData.tag,
                                        textName: mapData.tag,
                                        productPrice: t_2tSale.price,
                                        productName: t_2tSale.product_name
                                    });
                                }
                            });
                            resolve(t_2toils);
                        } else {
                            resolve([]);
                        }
                    });
            });
    });
}

// Used to join Expenses and t_expense data.
const txnExpensesPromise = (closingId, locationCode) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getTxnExpensesByClosingId(closingId, locationCode)
            .then(t_data => {
                if (t_data && t_data.length > 0) {
                    let t_expenses = [];
                    t_data.forEach((data) => {
                        let expenses = data.t_expenses;
                        if (expenses && expenses.length > 0) {
                            expenses.forEach((t_expense) => {
                                t_expenses.push({
                                    texpenseId: t_expense.texpense_id,
                                    expenseId: t_expense.expense_id,
                                    amount: t_expense.amount,
                                    notes: t_expense.notes,
                                    expenseName: data.Expense_name,
                                    defaultAmt: data.Expense_default_amt,
                                });
                            });
                        }
                    });
                    resolve({t_expenses: t_expenses});
                } else {
                    resolve({t_expenses:[]});
                }
            });
    });
}


const vehicleDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        CreditVehicleDao.findAllVehiclesForLocation(locationCode)
            .then(data => {
                // Group vehicles by creditlist_id for easier access
                const vehiclesByCredit = {};
                data.forEach(vehicle => {
                    if (!vehiclesByCredit[vehicle.creditlist_id]) {
                        vehiclesByCredit[vehicle.creditlist_id] = [];
                    }
                    vehiclesByCredit[vehicle.creditlist_id].push({
                        vehicleId: vehicle.vehicle_id,
                        vehicleNumber: vehicle.vehicle_number,
                        vehicleType: vehicle.vehicle_type,
                        companyName: vehicle.company_name
                    });
                });
                resolve(vehiclesByCredit);
            })
            .catch(err => {
                console.error("Error loading vehicles:", err);
                resolve({});
            });
    });
};
