
const db = require("../db/db-connection");
const Pump = db.pump;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");

module.exports = {
    findPumps: (locationCode) => {
                if (locationCode) {
            return Pump.findAll({
                where: { [Op.and]: [
                { 'location_code': locationCode }, {'effective_end_date': {[Op.gte] : now()}}
            ] },
                order: [Sequelize.literal('pump_code ASC')]
            });
        } else {
            return Pump.findAll();
        }
    },
    findPumpCodes: (pumpIds) => {
        return Pump.findAll({
            attributes: ['pump_id','pump_code'], where: {'pump_id': pumpIds}
        });
    },
    findPreviousDaysData: (locationCode) => {
        return Pump.findAll({
            attributes: ['pump_code', 'opening_reading', 'current_stamping_date', 'Stamping_due'],
                where: { [Op.and]: [
                { 'location_code': locationCode }, {'creation_date': {[Op.gte] : utils.getPreviousDay()}}
            ] }
        });
    }
};


