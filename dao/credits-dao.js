const db = require("../db/db-connection");
const Credit = db.credit;
const { Op } = require("sequelize");
const config = require("../config/app-config");
const Sequelize = require("sequelize");
const utils = require('../utils/app-utils');
const dateFormat = require('dateformat');

module.exports = {
    findAll: (locationCode) => {
        const currentDate = utils.currentDate();
        if (locationCode) {
            return Credit.findAll({
                where: {
                    location_code: locationCode,
                    effective_end_date: {
                        [Op.or]: {
                            [Op.gte]: currentDate,
                            [Op.is]: null
                        }
                    }
                },
                order: [Sequelize.literal('Company_Name')],
            });
        }
    },
    findCredits: (locationCode) => {
        const currentDate = utils.currentDate();
        if (locationCode) {
            return Credit.findAll({
                where: {
                    'location_code': locationCode,
                    'type': config.APP_CONFIGS.creditTypes[0], // 'Credit'
                    effective_end_date: {
                        [Op.or]: {
                            [Op.gte]: currentDate,
                            [Op.is]: null
                        }
                    }
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
                where: {
                    'location_code': locationCode,
                    'type': config.APP_CONFIGS.creditTypes[1]      // 'Suspense'
                },
                order: [Sequelize.literal('Company_Name')],
            });
        } else {
            return Credit.findAll({});
        }
    },
    findCreditDetails: (creditIds) => {
        return Credit.findAll({
            attributes: ['creditlist_id', 'Company_Name', 'type', 'card_flag','address', 'phoneno', 'gst', 'short_name'], where: { 'creditlist_id': creditIds },
            order: [Sequelize.literal('Company_Name')],
        });
    },
    create: (credit) => {
        return Credit.create(credit)
    },

    disableCredit: (creditID) => {
        let now = new Date();
        const formattedDate = dateFormat(now, "yyyy-mm-dd");
        console.log(formattedDate);
        return Credit.update({
            effective_end_date: formattedDate
        }, {
            where: { 'creditlist_id': creditID }
        });
    },

    findDisableCredits: (locationCode) => {
        console.log("locationCode: ", locationCode);
        const now = new Date(); // Current date
        return Credit.findAll({
            where: {
                [Op.and]: [
                    { location_code: locationCode }, // Match location code
                    { effective_end_date: { [Op.lt]: now } } // effective_end_date < current date
                ]
            },
            order: [
                ['effective_end_date', 'DESC']
            ]
        });
    },

    enableCredit: (creditID) => {
        const UpdateDate = "2400-01-01"; // Use this fixed date
        return Credit.update(
            { effective_end_date: UpdateDate },
            { where: { creditlist_id: creditID } }
        );
    },
};
