const db = require("../db/db-connection");
const Tank = db.tank;
const PumpTank = db.pump_tank;
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
    // findActiveTanks: (locationCode) => {
    //     if (locationCode) {
    //         return Tank.findAll({
    //             attributes: ['tank_id', 'tank_code', 'product_code', 'tank_orig_capacity', 'dead_stock', 'dipchartid'],
    //             include: [{
    //                 model: db.tank_dipchart_header,
    //                 attributes: ['dipchartid', 'chart_name'],
    //                 include: [{
    //                     model: db.tank_dipchart_lines,
    //                     attributes: ['dip_cm', 'volume_liters', 'diff_liters_mm'],
    //                     where: {
    //                         dip_cm: { [Op.lt]: 5 } // Filtering dip_cm values less than 5
    //                     },
    //                     order: [['dip_cm', 'ASC']],
    //                 }]
    //             }],
    //             where: { 
    //                 [Op.and]: [
    //                     {'location_code': locationCode},
    //                     {'effective_start_date': {[Op.lte]: utils.currentDate()}},
    //                     {'effective_end_date': {[Op.gte]: utils.currentDate()}},   
    //                     { 'tank_id': 10 } // Filtering for tank_id = 10
    //                 ]
    //             },
    //             order: [Sequelize.literal('tank_code ASC')]
    //         }).then(tanks => {
    //             // Check if the tank has the required data before processing
    //               // Log the full tank data for debugging purposes
    //                  console.log("Tanks data:", JSON.stringify(tanks, null, 2)); // Log tank data


    //             return tanks.map(tank => {
    //                 // Check if tank has dipchart header and lines
    //                 if (!tank.tank_dipchart_header || !tank.tank_dipchart_header.tank_dipchart_lines) {
    //                     console.error('Dip chart lines not found for tank', tank.tank_id);
    //                     return tank; // Return the tank as-is if there's no dip chart data
    //                 }
    
    //                 // Process each tank's dipchart lines
    //                 let lastVolume = 0;
    //                 const updatedDipChartLines = tank.tank_dipchart_header.tank_dipchart_lines.map(line => {
    //                     // For the first entry, just assign the volume
    //                     let newVolume = lastVolume + line.diff_liters_mm;
    //                     lastVolume = newVolume; // Update last volume for next iteration
                        
    //                     // Calculate new volume for the dip_cm
    //                     return {
    //                         dip_cm: line.dip_cm,
    //                         volume_liters: line.volume_liters + newVolume, // Add the cumulative volume
    //                         diff_liters_mm: line.diff_liters_mm
    //                     };
    //                 });
    
    //                 // Return the tank with updated dip chart lines
    //                 return {
    //                     ...tank,
    //                     tank_dipchart_header: {
    //                         ...tank.tank_dipchart_header,
    //                         tank_dipchart_lines: updatedDipChartLines
    //                     }
    //                 };
    //             });
    //         });
    //     } else {
    //         return Tank.findAll();
    //     }
    // }
    

    findActiveTanks: (locationCode) => {
        if (locationCode) {
            return Tank.findAll({
                attributes: [
                    'tank_id', 
                    'tank_code', 
                    'product_code', 
                    'tank_orig_capacity', 
                    'dead_stock', 
                    'dipchartid'
                ],
                include: [{
                    model: db.tank_dipchart_header,
                    attributes: ['dipchartid', 'chart_name'],
                    include: [{
                        model: db.tank_dipchart_lines,
                        attributes: [
                            'dip_cm', 
                            'volume_liters', 
                            'diff_liters_mm'
                        ],                       
                        order: [['dip_cm', 'ASC']]
                    }]
                }],
                where: { 
                    [Op.and]: [
                        {'location_code': locationCode},
                        {'effective_start_date': {[Op.lte]: utils.currentDate()}},
                        {'effective_end_date': {[Op.gte]: utils.currentDate()}}                        
                    ]
                },
                order: [Sequelize.literal('tank_code ASC')]
            })
            .then(tanks => {              
    
                return tanks.map(tank => {
                    // Early return if no dip chart data
                    if (!tank.m_tank_dipchart_header || !tank.m_tank_dipchart_header.m_tank_dipchart_lines) {                       
                        return tank;
                    }
    
                    let cumulativeVolume = 0;
                    const updatedLines = tank.m_tank_dipchart_header.m_tank_dipchart_lines.map(line => {
                        // Add the diff_liters_mm to cumulative volume
                        cumulativeVolume += (line.diff_liters_mm || 0);
                        
                        return {
                            ...line.toJSON(),
                            volume_liters: line.volume_liters + cumulativeVolume
                        };
                    });
    
                    // Return updated tank object with correct Sequelize structure
                    const tankData = tank.toJSON();
                    return {
                        ...tankData,
                        m_tank_dipchart_header: {
                            ...tankData.m_tank_dipchart_header,
                            m_tank_dipchart_lines: updatedLines
                        }
                    };
                });
            })
            .catch(error => {
                console.error('Error in findActiveTanks:', error);
                throw error;
            });
        } else {
            return Tank.findAll();
        }
    },
    create: (tankData, transaction) => {
        return Tank.create(tankData, {
            transaction: transaction
        });
    },

    findById: (tankId) => {
        return Tank.findOne({
            where: { tank_id: tankId }
        });
    },

    update: (tankId, tankData, transaction) => {
        return Tank.update(tankData, {
            where: { tank_id: tankId },
            transaction: transaction
        });
    },

    deactivate: async function(tankId, deactivateData, transaction) {
        const today = new Date();
        
        return await Tank.update(deactivateData, {
            where: { 
                tank_id: tankId,
                effective_end_date: {
                    [Op.gt]: today
                }
            },
            transaction: transaction
        });
    },

    checkCodeOverlap: async (tankId, tankCode, startDate, locationCode) => {
        const overlapping = await Tank.findOne({
            where: {
                location_code: locationCode,
                tank_code: tankCode,
                [Op.and]: [
                    { effective_start_date: { [Op.lte]: startDate } },
                    { effective_end_date: { [Op.gt]: startDate } }
                ],
                ...(tankId && { tank_id: { [Op.ne]: tankId } })
            }
        });

        return !!overlapping;
    },
}
