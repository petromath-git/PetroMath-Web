const UtilsDao = require("../dao/utilities-dao");
const utils = require("../utils/app-utils");
const dateFormat = require('dateformat');

module.exports = {
    get: (req, res, next) => {
        Promise.allSettled([getChartNames(req.user.location_code, 'DipChartName')])
            .then((values) => {
                res.render('utilities', {
                    title: 'Utilities',
                    user: req.user,
                    currentDate: utils.currentDate(),
                    chartNames: values[0].value,
                });
            }).catch((err) => {
            console.warn("Error while getting data using promises " + err.toString());
            Promise.reject(err);
        });
    },
    getDensity: (req, res, next) => {
        UtilsDao.getDensity(req.query.temperature, req.query.density).then((result) => {
            if (result && !result.error) {
                res.status(200).send({message: 'Got data.', rowsData: result});
            } else {
                res.status(400).send({error: result ? result.error : 'No results found.'});
            }
        });
    },
    getDipChart: (req, res, next) => {
        UtilsDao.getDipChart(req.query.chart_name, req.query.dip_reading).then((result) => {
            if (result && !result.error) {
                res.status(200).send({message: 'Got data.', rowsData: result});
            } else {
                res.status(400).send({error: result ? result.error : 'No results found.'});
            }
        });
    },
    getTallyExport: (req, res, next) => {
        let exportDate = dateFormat(req.body.exportDate, "yyyy-mm-dd");
        let locationCode = req.user.location_code;
        UtilsDao.getTallyXmlData(exportDate, locationCode).then((result) => {
            if (result && !result.error) {
                res.set({
                    'Content-Disposition': 'attachment; filename=\"tallyexp-' +locationCode+'-'+ exportDate + '.xml\"',
                    'Content-type': 'application/xml'
                });
                res.send(result[0][0].xmlData);
            } else {
                res.status(400).send({error: result ? result.error : 'No results found.'});
            }
        });
    }
}

const getChartNames = (locationCode, lookUpCode) => {
    return new Promise((resolve, reject) => {
        let chartNames = [];
        UtilsDao.getChartNames(locationCode, lookUpCode)
            .then(data => {
                data.forEach((chart) => {
                    chartNames.push({
                        id: chart.lookup_id,
                        chartName: chart.description
                    });
                });
                resolve(chartNames);
            });
    });
}