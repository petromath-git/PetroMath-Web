const db = require("../db/db-connection");
const Tank = db.tank;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");

module.exports = {
    findTanks: (locationCode) => {
		if (locationCode) {
            return Tank.findAll({
                where: {'location_code': locationCode},
                order: [Sequelize.literal('tank_code ASC')]
            });
        } else {
            return Tank.findAll();
        }
    },
    findTankCodes: (tankIds) => {
        return Tank.findAll({
            attributes: ['tank_id','tank_code','product_code'], where: {'tank_id': tankIds}
        });
    },
    findActiveTanks: (locationCode) => {
		if (locationCode) {
            return Tank.findAll({
                attributes: ['tank_id','tank_code','product_code'],
                where: { [Op.and]: [
                    {'location_code': locationCode},
                    {'effective_start_date': {[Op.lte] : utils.currentDate()}},
                     {'effective_end_date': {[Op.gte] : utils.currentDate()}}   
                    ]},
                order: [Sequelize.literal('tank_code ASC')]
            });
        } else {
            return Tank.findAll();
        }
    }
}
