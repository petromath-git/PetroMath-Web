const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const PersonDao = require("../dao/person-dao");
const TruckLoadDao = require("../dao/txn-truckload-dao");
const TruckDao = require("../dao/truck-dao");
const TruckExpDao = require("../dao/txn-truckexpense-dao");

module.exports = {

    // Getting home data
    getTruckData: (req, res, next) => {
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        if(req.query.fromDate) {
            fromDate = req.query.fromDate;
        }
        if(req.query.toDate) {
            toDate = req.query.toDate;
        }
  
        Promise.allSettled([getTruckLoadByDate(locationCode,fromDate,toDate),
                getDriverHelper(locationCode),
                truckDataPromise(locationCode),
                decantLocationPromise(locationCode),
                getLocationIdCodemap(),
                getExpenseTypePromise(),
                getPaymentmodePromise(),
                ])
            .then((values) => {
                
                res.render('truck-load',{user: req.user,
                title:'Truck Load',
                config: config.APP_CONFIGS,
                truckLoadData: values[0].value.loadDatalist,
                drivers: values[1].value.drivers,
                trucks: values[2].value.trucks,
                trucklocs: values[3].value.trucklocs,
                locations: values[4].value.locidcodemap,
                expenseTypes: values[5].value,
                paymentModes: values[6].value,
                fromDate: fromDate,
                toDate: toDate,
                currentDate: utils.currentDate(),
                locationcode: locationCode
                });
        });
    
    },

    saveTruckData: (req, res, next) => {
        TruckLoadDao.create(dbMapping.newTruckLoad(req));
        res.redirect('/truck-load?fromDate=' + req.body.truck_fromDate_hiddenValue +
            '&toDate=' + req.body.truck_toDate_hiddenValue);
    },

    deleteTruckLoad: (req, res, next) => {
        if(req.query.id) {
            TruckLoadDao.delete(req.query.id)
                .then(data => {
                    if (data == 1) {
                        res.status(200).send({message: 'Truck Load successfully deleted.'});
                    } else {
                        res.status(500).send({error: 'Truck Load deletion failed or not available to delete.'});
                    }
                });
        } else {
            res.status(500).send({error: 'Truck Load failed or not available to delete.'});
        }
    },
    getTruckExpenseData: (req, res, next) => {
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        if(req.query.expfromDate) {
            fromDate = req.query.expfromDate;
        }
        if(req.query.exptoDate) {
            toDate = req.query.exptoDate;
        }
  
        Promise.allSettled([
                truckDataPromise(locationCode),
                getLocationIdCodemap(),
                getExpenseTypePromise(),
                getPaymentmodePromise(),
                getTruckExpenseByDate(locationCode,fromDate,toDate)
                ])
            .then((values) => {
                
                res.render('truck-expense',{user: req.user,
                title:'Truck Expense',
                config: config.APP_CONFIGS,
                trucks: values[0].value.trucks,
                locations: values[1].value.locidcodemap,
                expenseTypes: values[2].value,
                paymentModes: values[3].value,
                expenseData: values[4].value.expenseDatalist,
                fromDate: fromDate,
                toDate: toDate,
                currentDate: utils.currentDate(),
                locationcode: locationCode
                });
        });
    },
    saveTruckExpenseData: (req, res, next) => {
        TruckExpDao.create(dbMapping.newTruckExpense(req));
        res.redirect('/truck-expense?expfromDate=' + req.body.exp_fromDate_hiddenValue +
            '&exptoDate=' + req.body.exp_toDate_hiddenValue);
    },
    deleteTruckExpense: (req, res, next) => {
        if(req.query.id) {
            TruckExpDao.delete(req.query.id)
                .then(data => {
                    if (data == 1) {
                        res.status(200).send({message: 'Truck Expense successfully deleted.'});
                    } else {
                        res.status(500).send({error: 'Truck Expense deletion failed or not available to delete.'});
                    }
                });
        } else {
            res.status(500).send({error: 'Truck Expense failed or not available to delete.'});
        }
    },
}

const getTruckLoadByDate = (locationCode, fromDate,toDate) => {
    return new Promise((resolve, reject) => {
        let loadDatalist=[];
        TruckLoadDao.getTruckLoadByDate(locationCode,fromDate,toDate)
            .then(data => {
                data.forEach((loadData) => {
                    loadDatalist.push({
                        tload_id: loadData.truck_load_id,
                        invoice_date:dateFormat(loadData.invoice_date,"dd-mm-yyyy"),
                        invoice_number:loadData.invoice_number,
                        decant_date:dateFormat(loadData.decant_date,"dd-mm-yyyy"),
                        decant_time:loadData.decant_time,
                        truck_number:loadData.truck_id,
                        decant_location:loadData.location_id,
                        driver:loadData.driver_id,
                        helper:loadData.helper_id,
                        odometer_reading:loadData.odometer_reading,
                        ttank_id:loadData.ttank_id,
                        MS:loadData.MS,
                        HSD:loadData.HSD,
                        XMS:loadData.XMS

                    });
                    
                });

                resolve({loadDatalist:loadDatalist});
            });
    });
}

const getDriverHelper =(locationCode) => {
    return new Promise((resolve, reject) => {
        let drivers = [];
        PersonDao.findDrivers(locationCode)
            .then(data => {
                data.forEach((person) => {
                    drivers.push({personName: person.Person_Name, personId: person.Person_id});
                });
                resolve({drivers: drivers});
            });
    });
}

const truckDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let trucks = [];
        TruckDao.getTruckno(locationCode)
            .then(data => {
                data.forEach((truck) => {
                    trucks.push({truck_id: truck.truck_id, truck_number: truck.truck_number});
                });
                resolve({trucks: trucks});
            });

    });
}


const getLocationIdCodemap =() => {
    return new Promise((resolve, reject) => {
        let locidcodemap = [];
        TruckLoadDao.getLocationId()
            .then(data => {
                data.forEach((val) => {
                    locidcodemap.push({id: val.location_id, code: val.location_code});
                });
                resolve({locidcodemap: locidcodemap});
            });
    
    });
}

const decantLocationPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let trucklocs = [];
            TruckLoadDao.getDecantLoc(locationCode)
            .then(data => {
                data.forEach((loc) => {
                trucklocs.push({loc_id: loc.location_id, loc_code: loc.location_code,
                                    decloc_id: loc.decant_location, decloc_code:loc.decant_location_code});
                });
            resolve({trucklocs: trucklocs});
            });
    });
}

const getExpenseTypePromise = () => {
    return new Promise((resolve, reject) => {
        let expenseTypes = [];
            TruckExpDao.getExpenseType()
                .then(data => {
                    data.forEach((etype) => {
                        expenseTypes.push({
                            id: etype.lookup_id,
                            expense: etype.description
                    });
                });
                resolve(expenseTypes);
            });
    });
}

const getPaymentmodePromise = () => {
    return new Promise((resolve, reject) => {
        let paymentModes = [];
            TruckExpDao.getPaymentMode()
                .then(data => {
                    data.forEach((etype) => {
                        paymentModes.push({
                            id: etype.lookup_id,
                            paymode: etype.description
                    });
                });
                resolve(paymentModes);
            });
    });
}

const getTruckExpenseByDate = (locationCode, fromDate,toDate) => {
    return new Promise((resolve, reject) => {
        let expenseDatalist=[];
        TruckExpDao.getTruckExpenseByDate(locationCode,fromDate,toDate)
            .then(data => {
                let isDeleteAllowed=false;
                data.forEach((expenseData) => {
                    isDeleteAllowed = utils.noOfDaysDifference(expenseData.expense_date, utils.currentDate())
                    == 0 ? true : false;
                    expenseDatalist.push({
                        truckexp_id: expenseData.truckexp_id,
                        expense_date:dateFormat(expenseData.expense_date,"dd-mm-yyyy"),
                        truck_id:expenseData.truck_id,
                        expense_id:expenseData.expense_id,
                        costcenter_id:expenseData.costcenter_id,
                        amount:expenseData.amount,
                        qty:expenseData.qty,
                        payment_mode:expenseData.payment_mode,
                        notes:expenseData.notes,
                        showDelete:isDeleteAllowed,
                        cashflow_flag:expenseData.cashflow_done_flag
                        
                    });
                });
                resolve({expenseDatalist:expenseDatalist});
            });
    });
}
 

