const db = require("../db/db-connection");
const Density = db.density;
const DipChart = db.tank_dip_chart;
const Lookup = db.lookup;
const { Sequelize, Op } = require("sequelize");

module.exports = {
    getDensity: (temperature, density) => {
        return Density.findOne({
            attributes: ['density_at_15'],
            where: { 'temparture': temperature, 'density': density }
        });
    },

    getDipChart: (chart_name, reading) => {
        return DipChart.findOne({
            attributes: ['volume'],
            where: { 'dip_chart_name': chart_name, 'dip_reading': reading }
        });
    },

    getChartNames: (location_code, lookup_type) => {
        return Lookup.findAll({
            attributes: ['lookup_id','description'],
            where: { 'location_code': location_code, 'lookup_type': lookup_type }
        });
    },

    // ===== Tally XML with filename context =====
    getTallyXmlData: (exportDate, locationCode) => {
        return db.sequelize.query(
            "SELECT tally_export(:exportDate, :locationCode, 'EXPORT') AS xmlData;",
            {
                replacements: { exportDate: exportDate, locationCode: locationCode },
                type: db.Sequelize.QueryTypes.SELECT,
                raw: true,
            }
        ).then(rows => {
            if (rows && rows[0]) {
                const xmlData = rows[0].xmlData;

                // Format filename
                const d = new Date(exportDate);
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const monthName = monthNames[d.getMonth()];
                const year = d.getFullYear();

                const fileName = `tallyexp-${locationCode}-${monthName}${year}.xml`;

                return { exportDate, locationCode, fileName, xmlData };
            }
            return null;
        });
    }
};
