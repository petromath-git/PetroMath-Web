const db = require("../db/db-connection");
const Pump = db.pump;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");

module.exports = {
    findPumps: (locationCode) => {
        if (locationCode) {
            return Pump.findAll({
                where: { 
                    [Op.and]: [
                        { 'location_code': locationCode }, 
                        {'effective_end_date': {[Op.gte] : utils.getPreviousDay()}}
                    ] 
                },
                order: [Sequelize.literal('pump_code ASC')]
            });
        } else {
            return Pump.findAll();
        }
    },

    findPumpCodes: (pumpIds) => {
        return Pump.findAll({
            attributes: ['pump_id','pump_code'], 
            where: {'pump_id': pumpIds}
        });
    },

    findPreviousDaysData: (locationCode) => {
        return Pump.findAll({
            attributes: ['pump_code', 'opening_reading', 'current_stamping_date', 'Stamping_due'],
            where: { 
                [Op.and]: [
                    { 'location_code': locationCode }, 
                    {'creation_date': {[Op.gte] : utils.getPreviousDay()}}
                ] 
            }
        });
    },

    // New methods needed for pump master functionality
    create: (pumpData, transaction) => {
        return Pump.create(pumpData, {
            transaction: transaction
        });
    },

    update: (pumpId, pumpData, transaction) => {
        return Pump.update(pumpData, {
            where: { pump_id: pumpId },
            transaction: transaction
        });
    },

    deactivate: async function(pumpId, deactivateData, transaction) {
        const today = new Date();
        
        return await Pump.update(deactivateData, {
            where: { 
                pump_id: pumpId,
                effective_end_date: {
                    [Op.gt]: today
                }
            },
            transaction: transaction
        });
    },

    // checkDateOverlap: async (pumpId, startDate, locationCode) => {
    //     const overlapping = await Pump.findOne({
    //         where: {
    //             location_code: locationCode,
    //             [Op.and]: [
    //                 { effective_start_date: { [Op.lte]: startDate } },
    //                 { effective_end_date: { [Op.gt]: startDate } }
    //             ],
    //             ...(pumpId && { pump_id: { [Op.ne]: pumpId } })
    //         }
    //     });
    //     return !!overlapping;
    // },

    checkDateOverlap: async (pumpId, pumpCode, startDate, locationCode) => {
        console.log('Checking overlap for:', {
            pumpId,
            pumpCode,
            startDate,
            locationCode
        });
    
        const overlapping = await Pump.findOne({
            where: {
                location_code: locationCode,
                pump_code: pumpCode,  // Add this to check for specific pump code
                [Op.and]: [
                    { effective_start_date: { [Op.lte]: startDate } },
                    { effective_end_date: { [Op.gt]: startDate } }
                ],
                ...(pumpId && { pump_id: { [Op.ne]: pumpId } })
            }
        });
    
        console.log('Overlap result:', {
            hasOverlap: !!overlapping,
            overlappingRecord: overlapping ? {
                pump_id: overlapping.pump_id,
                pump_code: overlapping.pump_code,
                effective_dates: `${overlapping.effective_start_date} to ${overlapping.effective_end_date}`
            } : null
        });
    
        return !!overlapping;
    },


    findById: (pumpId) => {
        return Pump.findOne({
            where: { pump_id: pumpId }
        });
    }
};