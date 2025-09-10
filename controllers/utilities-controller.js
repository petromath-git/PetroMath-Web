const UtilsDao = require("../dao/utilities-dao");
const utils = require("../utils/app-utils");
const dateFormat = require('dateformat');

module.exports = {
get: (req, res, next) => {
    // Calculate available years
    const currentYear = new Date().getFullYear();
    const availableYears = [];
    for (let year = 2020; year <= currentYear; year++) {
        availableYears.push(year);
    }

    Promise.allSettled([getChartNames(req.user.location_code, 'DipChartName')])
        .then((values) => {
            res.render('utilities', {
                title: 'Utilities',
                user: req.user,
                currentDate: utils.currentDate(),
                currentYear: currentYear,
                availableYears: availableYears,
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
    // Get month and year from form
    let exportMonth = req.body.exportMonth;
    let exportYear = req.body.exportYear;
    
    // Validate inputs
    if (!exportMonth || !exportYear) {
        return res.status(400).send({ error: 'Month and year are required.' });
    }
    
    // Create date as first day of the month in YYYY-MM-DD format
    // The DB function expects a DATE, so we'll send it as first day of month
    let exportDate = `${exportYear}-${exportMonth}-01`;
    
    let locationCode = req.user.location_code;

    UtilsDao.getTallyXmlData(exportDate, locationCode).then((rows) => {
        if (rows && rows[0] && !rows.error) {
            // Create a nice filename with month name
            let monthNames = [
                'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
            ];
            let monthName = monthNames[parseInt(exportMonth) - 1];
            
            res.set({
                'Content-Disposition': `attachment; filename="tallyexp-${locationCode}-${monthName}${exportYear}.xml"`,
                'Content-type': 'application/xml'
            });
            res.send(rows[0].xmlData);
        } else {
            res.status(400).send({ error: rows ? rows.error : 'No results found.' });
        }
    }).catch((err) => {
        res.status(500).send({ error: err.message });
    });
},


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