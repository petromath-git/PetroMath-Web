const utils = require("../utils/app-utils");
const dateFormat = require('dateformat');
const config = require("../config/app-config");
const homeController = require("./home-controller");
const TxnTankRcptDao = require ("../dao/txn-tankrcpt-dao");
const PersonDao = require("../dao/person-dao");
const tankreceiptController = require("./tank-receipt-controller");
const TankDao = require("../dao/tank-dao");
const TxnStkRcptDtlDao = require("../dao/txn-stkrcpt-dtl-dao");
const TruckDao = require("../dao/truck-dao");

module.exports = {
    getDataToEdit: (req, res, next) => {
        const ttank_id = req.query.closingId;
        const locationCode = req.user.location_code;
        if(ttank_id){
            Promise.allSettled([personDataPromise(locationCode),
                txntankReceiptPromise(ttank_id),
                getDriverHelper(locationCode),
                tankCodePromise(locationCode),
                txnDecantLinesPromise(ttank_id),
                truckDataPromise(locationCode),
                ])
                .then((values) => {
                    res.render('edit-draft-tankrcpt',{
                        user: req.user,
                        config: config.APP_CONFIGS,
                        inchargers: values[0].value.inchargers,
                        currentDate: utils.currentDate(),
                        receiptsData: values[1].value,
                        drivers: values[2].value.drivers,
                        tanks: values[3].value.tanks,
                        decantLines: values[4].value.decantLines,
                        trucks: values[5].value.trucks,
                        
                    });
                    
                }).catch((err) => {
                    console.warn("Error while getting data using promises " + err.toString());
                    Promise.reject(err);
                });
               
        }else {
            res.render('home', {user: req.user});
        }
     
    }
}
const txntankReceiptPromise = (ttank_id) => {
    return new Promise((resolve, reject) => {
        TxnTankRcptDao.getReceiptDetails(ttank_id)
            .then(data => {
                resolve({
                    ttank_id: data.ttank_id,
                    invoice_date: data.invoice_date,
                    h_invoiceDate: data.invoice_date_fmt1,
                    invoice_number: data.invoice_number,
                    decant_date:data.decant_date,
                    h_decantDate:data.decant_date_fmt1,
                    decant_incharge: data.decant_incharge,
                    truck_number: data.truck_number,
                    driver_id: data.driver_id,
                    helper_id: data.helper_id,
                    closingStatus: data.closing_status,
                    odometer_reading: data.odometer_reading,
                    decant_time: data.decant_time,
                    truck_halt_flag: data.truck_halt_flag,
                    location_id: data.location_id
                    });
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

const personDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let inchargers = [];
        PersonDao.findUsers(locationCode)
            .then(data => {
                data.forEach((person) => {
                    inchargers.push({personName: person.Person_Name, personId: person.Person_id});
                });
                resolve({inchargers: inchargers});
            });
    });
}
const tankCodePromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let tanks = [];
        TankDao.findActiveTanks(locationCode)
            .then(data => {
                data.forEach((tank) => {
                    tanks.push({
                        tankId: tank.tank_id,
                        productCode: tank.product_code,
                        tankCode: tank.tank_code,
                    });
                });
                resolve({tanks: tanks});
            });
            
    });
}

const txnDecantLinesPromise = (ttank_id) => {
    return new Promise((resolve, reject) => {
        let decantLines = [];
        TxnStkRcptDtlDao.getdecantlinesdata(ttank_id)
            .then(data => {
                data.forEach((decantdata) => {
                    decantLines.push({
                        tdtank_id: decantdata.tdtank_id,
                        ttank_id: decantdata.ttank_id,
                        tank_id: decantdata.tank_id,
                        quantity: (decantdata.quantity).toString(),
                        closing_dip: decantdata.closing_dip,
                        opening_dip: decantdata.opening_dip,
                        EB_MS_FLAG: decantdata.EB_MS_FLAG,
                        notes: decantdata.notes,
                        amount: decantdata.amount

                    });
                });
                resolve({decantLines: decantLines});

            })
    })
}
const truckDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let trucks = [];
        TruckDao.getAllTruckno(locationCode)
            .then(data => {
                data.forEach((truck) => {
                    trucks.push({truck_id: truck.truck_id, truck_number: truck.truck_number});
                });
                resolve({trucks: trucks});
            });

    });
}

