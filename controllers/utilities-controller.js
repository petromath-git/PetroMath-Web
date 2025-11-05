const UtilsDao = require("../dao/utilities-dao");
const utils = require("../utils/app-utils");
const dateFormat = require('dateformat');
const archiver = require('archiver');   // 👈 add this

module.exports = {
    get: (req, res, next) => {
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
                success: req.query.success,  // Add this
                error: req.query.error        // Add this
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

    // ========== Single month export ==========
   getTallyExport: (req, res, next) => {
    let exportMonth = req.body.exportMonth;
    let exportYear = req.body.exportYear;

    if (!exportMonth || !exportYear) {
        return res.status(400).send({ error: 'Month and year are required.' });
    }

    let exportDate = `${exportYear}-${exportMonth}-01`;
    let locationCode = req.user.location_code;

    UtilsDao.getTallyXmlData(exportDate, locationCode).then((result) => {
        if (result) {
            res.set({
                'Content-Disposition': `attachment; filename="${result.fileName}"`,
                'Content-type': 'application/xml'
            });
            res.send(result.xmlData);
        } else {
            res.status(400).send({ error: 'No results found.' });
        }
    }).catch((err) => {
        res.status(500).send({ error: err.message });
    });
},

generateDaybook: (req, res, next) => {
    const { exportMonth, exportYear } = req.body;
    const locationCode = req.user.location_code;

    if (!exportMonth || !exportYear) {
        return res.redirect('/utilities?error=Month and year are required');
    }

    // Format period as "Apr-2024"
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const period = monthNames[parseInt(exportMonth) - 1] + '-' + exportYear;

    UtilsDao.runTallyExports(period, period, locationCode)
        .then((result) => {
            if (result && !result.error) {
                res.redirect('/utilities?success=Daybook generated successfully for ' + period);
            } else {
                res.redirect('/utilities?error=' + encodeURIComponent(result ? result.error : 'Failed to generate daybook'));
            }
        })
        .catch((err) => {
            console.error('Error generating daybook:', err);
            res.redirect('/utilities?error=' + encodeURIComponent(err.message));
        });
},


    // ========== Financial year ZIP export ==========
    getTallyExportRange: async (req, res, next) => {
    try {
        const { financialYear } = req.body;
        const locationCode = req.user.location_code;

        if (!financialYear || !locationCode) {
            return res.status(400).send({ error: "Missing required parameters" });
        }

        const [startDate, endDate] = financialYear.split(":");

        res.setHeader('Content-Disposition', `attachment; filename="tallyexp-${locationCode}.zip"`);
        res.setHeader('Content-Type', 'application/zip');

        const archiver = require('archiver');
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        let current = new Date(startDate);
        const end = new Date(endDate);

        while (current <= end) {
            let exportDate = current.toISOString().slice(0, 10);
            let result = await UtilsDao.getTallyXmlData(exportDate, locationCode);

            if (result) {
                archive.append(result.xmlData, { name: result.fileName });
            }

            current.setMonth(current.getMonth() + 1);
        }

        await archive.finalize();
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
}



};

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
};
