const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const PersonDao = require("../dao/person-dao");
const TxnReadDao = require("../dao/txn-read-dao");
const TxnTankRcptDao = require ("../dao/txn-tankrcpt-dao");
const TxnStkRcptDtlDao = require("../dao/txn-stkrcpt-dtl-dao");
const TankDao = require("../dao/tank-dao");
const TruckDao = require("../dao/truck-dao");


module.exports = {

        // Getting home data
    getTankReceipts: (req, res, next) => {
        getHomeData(req, res, next);
    },
    

    // Create Tank receipt - one at a time
    saveTankReceipts: (req, res, next) => {
        const receiptData = req.body;
        txnWriteReceiptPromise(receiptData)
            .then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved decant header successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
    },

   //function to load the decant header
    getNewData: (req, res, next) => {
        const locationCode = req.user.location_code;
        getDraftsCount(locationCode).then(data => {
            if(data < config.APP_CONFIGS.maxAllowedDrafts) {
                Promise.allSettled([personDataPromise(locationCode),
                    getDriverHelper(locationCode),
                    tankCodePromise(locationCode),
                    truckDataPromise(locationCode),
                    getLocationId(locationCode)])                        
                    .then((values) => {
                        res.render('new-decant', {
                            user: req.user,
                            config: config.APP_CONFIGS,
                            inchargers: values[0].value.inchargers,
                            currentDate: utils.currentDate(),
                            drivers: values[1].value.drivers,
                            tanks: values[2].value.tanks,
                            trucks: values[3].value.trucks,
                            location: values[4].value.location_id
                        });
                    }).catch((err) => {
                    console.warn("Error while getting data using promises " + err.toString());
                    Promise.reject(err);
                    });
            } else {
                getTankReceipts(req, res, next);
            }
        })

    },
    // delete tank receipts
    deleteTankReceipts: (req, res,next)  => {
        TxnTankRcptDao.deletetankReceipt(req.query.id).then(() => {
            // TODO: fix the data check later, not finding proper documentation on it.
            res.status(200).send({message: 'The Tank receipt is deleted successfully.'});
        }).error((err) => {
            res.status(500).send({error: 'Error while deleting the Tank Receipt.'});
        });
      
    },

    // Delete Decant Line
    deleteDecantLines: (req, res, next) => {
        const decantLineId = req.query.id;
        if (decantLineId) {
            txnDeleteDecantLinePromise(decantLineId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    },
//save decant lines
    saveDecantLines: (req, res, next) => {
        const decantLineData=req.body;
        txnWriteDecantLinesPromise(decantLineData)
            .then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved Decant Lines successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
    },

    closeData: (req, res, next) => {
        TxnTankRcptDao.finishClosing(req.query.id).then(() => {
                res.status(200).send({message: 'The decant record is made final.'});
                }).error((err) => {
                    res.status(500).send({error: 'Error while closing the Tank Receipt.'});
                });
    }
    
}
const getDraftsCount = (locationCode) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDraftClosingsCount(locationCode)
            .then(data => {
                resolve(data);
            });
    });
}

// Add new flow: Get person data
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

const getDraftsCountBeforeDays = (locationCode, noOfDays) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDraftClosingsCountBeforeDays(locationCode, noOfDays)
            .then(data => {
                resolve(data);
            });
    });
}


const txnWriteReceiptPromise = (receiptData) => {
    return new Promise((resolve, reject) => {
        TxnTankRcptDao.saveReceiptData(receiptData)
            .then(data => {
                resolve(data);
            }).catch((err) => {
            console.error("Error while saving Decant Header " + err.toString());
            resolve({error: err.toString()});
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

const txnWriteDecantLinesPromise = (decantLineData) => {
    return new Promise((resolve, reject) => {
        TxnStkRcptDtlDao.saveDecantLineData(decantLineData)
        .then(data => {
            resolve(data);
        }).catch((err) => {
        console.error("Error while saving Decant Lines " + err.toString());
        resolve({error: err.toString()});
    });
    });
}

const txnDeleteDecantLinePromise = (decantLineId) => {
    return new Promise((resolve, reject) => {
        TxnStkRcptDtlDao.deleteDecantLineById(decantLineId)
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

const getHomeData = (req, res, next) => {
    let locationCode = req.user.location_code;
    let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    if(req.query.tankreceipts_fromDate) {
        fromDate = req.query.tankreceipts_fromDate;
    }
    if(req.query.tankreceipts_toDate) {
        toDate = req.query.tankreceipts_toDate;
    }
    Promise.allSettled([getTankRcptByDate(locationCode, fromDate, toDate)])
        .then(values => {
            res.render('tankreceipts', {
                title: 'Tank Receipts',
                user: req.user,
                config: config.APP_CONFIGS,
                tankReceiptsValues: values[0].value,
                currentDate: utils.currentDate(),
                fromDate: fromDate,
                toDate: toDate,
            });

            console.log("inside tank");
        });      
    
}

const getTankRcptByDate = (locationCode, fromDate, toDate) => {
    return new Promise((resolve, reject) => {
        let receipts = [];
        TxnTankRcptDao.getTankRcptByDate(locationCode, fromDate, toDate)
            .then(data => {
                data.forEach((receiptsData) => {
                    receipts.push({ttank_id: receiptsData.ttank_id,
                        invoice_date: receiptsData.fomratted_inv_date,
                        invoice_number: receiptsData.invoice_number,
                        decant_date: receiptsData.fomratted_decant_date,
                        decant_time: receiptsData.decant_time,
                        decant_incharge: receiptsData.decant_incharge,
                        truck_number: receiptsData.truck_number,
                        odometer_reading: receiptsData.odometer_reading,
                        amount:receiptsData.amount,
                        driver: receiptsData.driver,
                        helper: receiptsData.helper,
                        closingStatus: receiptsData.closing_status,
                        MS: receiptsData.MS,
                        HSD: receiptsData.HSD,
                        XMS: receiptsData.XMS
                    });
                });
                resolve(receipts);
            });
            
    });
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

const getLocationId = (locationCode) => {
    return new Promise((resolve, reject) => {
        let location_id;
        TxnTankRcptDao.getLocationId(locationCode)
            .then(data => {
               location_id = data.location_id;
                resolve({location_id:location_id});
            });

    });
}
