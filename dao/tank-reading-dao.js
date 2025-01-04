const db = require("../db/db-connection");
const dateFormat = require("dateformat");
const TankReading = db.tank_reading;

function TankReadingDao() {
    this.create = async function(readingData) {
        const now = new Date();
        readingData.creation_date = now;
        readingData.updation_date = now;
        return await TankReading.create(readingData);
    };

    this.bulkCreate = async function(readings, transaction) {
        const now = new Date();
        const readingsWithDates = readings.map(reading => ({
            ...reading,
            creation_date: now,
            updation_date: now
        }));
        return await TankReading.bulkCreate(readingsWithDates, {
            transaction: transaction
        });
    };

    this.findByDipId = async function(tdip_id) {
        return await TankReading.findAll({
            where: { tdip_id: tdip_id },
            include: [{
                model: db.pump,
                attributes: ['pump_code', 'pump_make']
            }],
            order: [['pump_id', 'ASC']]
        });
    };
}

module.exports = new TankReadingDao();