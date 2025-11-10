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
                            [Op.gt]: currentDate,
                            [Op.is]: null
                        }
                    }
                },
                order: [Sequelize.literal('Company_Name')],
            });
        }
    },
    findCreditsExcludeDigital: (locationCode) => {
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
                },
                [Op.or]: [
                    { card_flag: { [Op.ne]: 'Y' } },  // Not equal to 'Y'
                    { card_flag: { [Op.is]: null } }   // Or NULL
                ]
            },
            order: [Sequelize.literal('Company_Name')],
        });
    } else {
        return Credit.findAll({});
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
                    { effective_end_date: { [Op.lte]: now } } // effective_end_date < current date
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

    findDigitalCredits: (locationCode) => {
        const currentDate = new Date();
        return Credit.findAll({
            attributes: ['creditlist_id', 'Company_Name', 'type', 'card_flag'],
            where: {
                location_code: locationCode,
                card_flag: 'Y',  // Only digital companies
                type: 'Credit',
                effective_start_date: {
                    [Op.lte]: currentDate
                },
                [Op.or]: [
                    { effective_end_date: null },
                    {
                        effective_end_date: {
                            [Op.gte]: currentDate
                        }
                    }
                ]
            },
            order: [Sequelize.literal('Company_Name')],
        });
    },
findCustomerByPhone: async (phone) => {
        const query = `
            SELECT 
                mcl.creditlist_id,
                mcl.Company_Name,
                mcl.location_code,
                mcl.phoneno phone,
                mcl.card_flag
            FROM m_credit_list mcl
            WHERE mcl.phoneno = :phone            
            LIMIT 1
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { phone: phone },
            type: Sequelize.QueryTypes.SELECT
        });
        
        return result.length > 0 ? result[0] : null;
    },
    update: (creditlistId, updateData) => {
    return Credit.update(updateData, {
        where: { creditlist_id: creditlistId }
    });
    },    
    findByNameAndLocation: async (companyName, locationCode) => {
        try {
            const customer = await Credit.findOne({
                where: {
                    Company_Name: companyName,
                    location_code: locationCode
                }
            });
            return customer;
        } catch (error) {
            console.error('Error finding customer by name:', error);
            throw error;
        }
    },

    getVendorLookbackDays: async (creditlistId, locationCode) => {
  try {
    const query = `
      SELECT settlement_lookback_days 
      FROM m_creditlist 
      WHERE creditlist_id = ? AND location_code = ?
    `;
    const result = await db.query(query, [creditlistId, locationCode]);
    
    if (result && result[0] && result[0].settlement_lookback_days !== null) {
      return result[0].settlement_lookback_days;
    }
    
    return null; // Not configured at vendor level
    
  } catch (err) {
    console.error('Error fetching vendor lookback days:', err);
    return null;
  }
}
};
