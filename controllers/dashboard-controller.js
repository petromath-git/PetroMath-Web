const utils = require("../utils/app-utils");
const config = require("../config/app-config");
//const dateFormat = require('Date');

const TxnReadDao = require("../dao/txn-read-dao");

module.exports = {
    getCharatData: (req,res) => {
        const locationCode = req.user.location_code;
        //Date today = utils.currentDate();

      
       getClosingSaleByMonth(locationCode)
        .then(result => {
            // res.render('charts', {
            //     title: 'Dashboard',
            //     user: req.user,
            //     config: config.APP_CONFIGS,
            //     closingSales: values,
            // });
            if (result && !result.error) {
                //console.log(result);
                res.status(200).send({message: 'Got data.', rowsData: result});
            } else {
                res.status(400).send({error: result ? result.error : 'No results found.'});
            }
            //console.log(values);
        }).catch((err) => {
            // catch all potential errors
            console.error(err);
        });
    }
}

const getClosingSaleByMonth = (locationCode) => {
    return new Promise((resolve, reject) => {
        let closingSales = [];
        console.log("Month:"+utils.getLastThreeMonths(utils.currentDate()));
        TxnReadDao.getClosingSaleByMonth(locationCode).then(data => {
            data.forEach((closingData) => {
                //console.log(closingData.dataValues.Year+"/"+closingData.dataValues.Month);
                closingSales.push({
                    locationCode: closingData.location_code,
                    year: closingData.dataValues.Year,
                    month: closingData.dataValues.Month,
                    MS: closingData.MS,
                    HSD: closingData.HSD,
                    XMS: closingData.XMS,
                    
                });
            });
            //console.log(closingSales);
            resolve(closingSales);
        });
    });
}

