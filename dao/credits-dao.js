const db = require("../db/db-connection");
const Credit = db.credit;
const config = require("../config/app-config");
const Sequelize = require("sequelize");

module.exports = {
    findAll: (locationCode) => {
        if (locationCode) {
            return Credit.findAll({
                where: {'location_code': locationCode},
            order: [Sequelize.literal('Company_Name')],
            });
        }
    },
    findCredits: (locationCode) => {
        if (locationCode) {
            return Credit.findAll({
                where: {'location_code': locationCode,
                    'type' : config.APP_CONFIGS.creditTypes[0]      // 'Credit'
                
                },
            order: [Sequelize.literal('Company_Name')],
            });
        } else {
            return Credit.findAll({});
        }
    },
    findSuspenses: (locationCode) => {
        if (locationCode) {
            return Credit.findAll({
                where: {'location_code': locationCode,
                    'type' : config.APP_CONFIGS.creditTypes[1]      // 'Suspense'
                },
            order: [Sequelize.literal('Company_Name')],
            });
        } else {
            return Credit.findAll({});
        }
    },
    findCreditDetails: (creditIds) => {
        return Credit.findAll({
            attributes: ['creditlist_id','Company_Name', 'type', 'address', 'phoneno', 'gst', 'short_name'], where: {'creditlist_id': creditIds},
        order: [Sequelize.literal('Company_Name')],
        });
    },
    create: (credit) => {
        return Credit.create(credit)
    }
};
