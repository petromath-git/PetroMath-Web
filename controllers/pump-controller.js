const PumpDao = require("../dao/pump-dao");
const TankDao = require("../dao/tank-dao");
const PumpTankDao = require("../dao/pump-tank-dao");
const dbMapping = require("../db/ui-db-field-mapping");
const dateFormat = require("dateformat");
const db = require("../db/db-connection");

exports.getPumpMaster = async function (req, res, next) {
    try {
        const locationCode = req.user.location_code;
        
        // Get active pumps
        const pumps = await PumpDao.findPumps(locationCode);
        
        // Get active tanks for dropdown
        const tanks = await TankDao.findActiveTanks(locationCode);

          // Get unique products from active tanks
          const products = [...new Set(tanks.map(tank => tank.product_code))];
        
        // Get active pump-tank mappings if available
        let pumpTankMappings = [];
        if (typeof PumpTankDao.findActiveMappings === 'function') {
            pumpTankMappings = await PumpTankDao.findActiveMappings(locationCode);
        }


        res.render('pump-master', {
            title: 'Pump Master',
            user: req.user,
            pumps: pumps,
            tanks: tanks,
            products: products,
            pumpTankMappings: pumpTankMappings
        });
    } catch (error) {
        console.error('Error fetching pump master data:', error);
        next(error);
    }
};

// exports.savePump = async function (req, res, next) {
//     try {
//         console.log('1. Starting savePump');
//         const pumpData = dbMapping.newPump(req);
        
//         // Set default dates and audit fields
//         pumpData.effective_start_date = dateFormat(new Date(), "yyyy-mm-dd");
//         pumpData.effective_end_date = '2900-01-01';  // This is fine to keep as default
//         pumpData.created_by = req.user.User_Name;
//         pumpData.creation_date = new Date();
//         pumpData.location_code = req.user.location_code;

//         // Start transaction
//         const t = await db.sequelize.transaction();
        
//         try {
//             // Check for overlapping dates
//             const overlapping = await PumpDao.checkDateOverlap(
//                 null, // no pump_id for new pump
//                 pumpData.effective_start_date,
//                 pumpData.location_code
//             );

//             if (overlapping) {
//                 return res.status(400).json({
//                     success: false,
//                     message: 'Date overlaps with existing record'
//                 });
//             }

//             // Save pump
//             await PumpDao.create(pumpData, t);
//             await t.commit();
            
//             return res.json({
//                 success: true,
//                 message: 'Pump saved successfully'
//             });
//         } catch (txError) {
//             console.error('2. Transaction error:', txError);
//             await t.rollback();
//             throw txError;
//         }
//     } catch (error) {
//         console.error('Error in savePump:', error);
//         return res.status(500).json({
//             success: false,
//             message: error.message || 'Failed to save pump'
//         });
//     }
// };

// In pump-controller.js
exports.savePump = async function (req, res, next) {
    try {
        console.log('1. Starting savePump');
        const pumpData = dbMapping.newPump(req);
        
        // Set default dates and audit fields
        pumpData.effective_start_date = dateFormat(new Date(), "yyyy-mm-dd");
        pumpData.effective_end_date = '2900-01-01';
        pumpData.created_by = req.user.User_Name;
        pumpData.creation_date = new Date();
        pumpData.location_code = req.user.location_code;

        // Start transaction
        const t = await db.sequelize.transaction();
        
        try {
            // Check for overlapping dates for the same pump code
            const overlapping = await PumpDao.checkDateOverlap(
                null, // no pump_id for new pump
                pumpData.pump_code,  // Pass pump_code
                pumpData.effective_start_date,
                pumpData.location_code
            );

            if (overlapping) {
                throw new Error('A pump with this code is already active');
            }

            // Save pump
            await PumpDao.create(pumpData, t);
            await t.commit();
            
            return res.json({
                success: true,
                message: 'Pump saved successfully'
            });
        } catch (txError) {
            console.error('2. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in savePump:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to save pump'
        });
    }
};

exports.updatePump = async function (req, res, next) {
    try {
        console.log('1. Starting updatePump');
        const pumpId = req.params.id;
        const pumpData = dbMapping.updatePump(req);
        
        pumpData.updated_by = req.user.User_Name;
        pumpData.updation_date = new Date();

        // Start transaction
        const t = await db.sequelize.transaction();
        
        try {
            // Verify pump exists
            const existingPump = await PumpDao.findById(pumpId);
            if (!existingPump) {
                return res.status(404).json({
                    success: false,
                    message: 'Pump not found'
                });
            }

            await PumpDao.update(pumpId, pumpData, t);
            await t.commit();
            
            // Return JSON response for AJAX
            return res.json({
                success: true,
                message: 'Pump updated successfully'
            });
        } catch (txError) {
            console.error('2. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in updatePump:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update pump'
        });
    }
};



exports.deactivatePump = async function (req, res, next) {
    try {
        const pumpId = req.params.id;
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        
        const t = await db.sequelize.transaction();
        
        try {
            // Verify pump exists and is active
            const existingPump = await PumpDao.findById(pumpId);
            if (!existingPump) {
                throw new Error('Pump not found');
            }

            const currentEndDate = new Date(existingPump.effective_end_date);
            if (currentEndDate <= new Date()) {
                throw new Error('Pump is already inactive');
            }

            await PumpDao.deactivate(pumpId, {
                effective_end_date: today,
                updated_by: req.user.User_Name,
                updation_date: new Date()
            }, t);
            
            await t.commit();
            
            res.json({ success: true, message: 'Pump deactivated successfully' });
        } catch (txError) {
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error deactivating pump:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to deactivate pump: ' + error.message 
        });
    }
};

exports.savePumpTank = async function (req, res, next) {
    try {
        const pumpTankData = dbMapping.newPumpTank(req);
        console.log('Mapped pump-tank data:', pumpTankData);
        
        // Set default dates and audit fields
        pumpTankData.effective_start_date = dateFormat(new Date(), "yyyy-mm-dd");
        pumpTankData.effective_end_date = '2900-01-01';
        pumpTankData.created_by = req.user.User_Name;
        pumpTankData.creation_date = new Date();
        pumpTankData.location_code = req.user.location_code;

        const t = await db.sequelize.transaction();
        
        try {
            // Check if pump already has an active mapping
            const existingMappings = await PumpTankDao.findByPumpId(pumpTankData.pump_id);
            
            if (existingMappings && existingMappings.length > 0) {
                // End-date the existing mapping
                await PumpTankDao.update(existingMappings[0].pump_tank_id, {
                    effective_end_date: dateFormat(new Date(), "yyyy-mm-dd"),
                    updated_by: req.user.User_Name,
                    updation_date: new Date()
                }, t);
            }

            // Create new mapping
            await PumpTankDao.create(pumpTankData, t);
            await t.commit();
            
            return res.json({
                success: true,
                message: 'Pump-Tank mapping saved successfully'
            });
        } catch (txError) {
            console.error('2. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in savePumpTank:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to save pump-tank mapping'
        });
    }
};

exports.deactivatePumpTank = async function (req, res, next) {
    try {
        const pumpTankId = req.params.id;
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        
        const t = await db.sequelize.transaction();
        
        try {
            // Verify mapping exists and is active
            const existingMapping = await PumpTankDao.findById(pumpTankId);
            if (!existingMapping) {
                throw new Error('Pump-Tank mapping not found');
            }

            if (existingMapping.effective_end_date !== '2900-01-01') {
                throw new Error('Pump-Tank mapping is already inactive');
            }

            await PumpTankDao.deactivate(pumpTankId, {
                effective_end_date: today,
                updated_by: req.user.User_Name,
                updation_date: new Date()
            }, t);
            
            await t.commit();
            
            res.json({ success: true, message: 'Pump-Tank mapping deactivated successfully' });
        } catch (txError) {
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error deactivating pump-tank mapping:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to deactivate pump-tank mapping: ' + error.message 
        });
    }
};

exports.checkDateOverlap = async function (req, res) {
    try {
        const { pump_id, effective_start_date } = req.body;
        const locationCode = req.user.location_code;

        const overlapping = await PumpDao.checkDateOverlap(
            pump_id,
            effective_start_date,
            locationCode
        );

        res.json({
            hasOverlap: overlapping,
            message: overlapping ? 'Date overlaps with existing record' : null
        });
    } catch (error) {
        console.error('Error checking date overlap:', error);
        res.status(500).json({ 
            error: 'Validation failed',
            message: 'Please try again'
        });
    }
};