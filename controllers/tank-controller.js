const TankDao = require("../dao/tank-dao");
const PumpTankDao = require("../dao/pump-tank-dao");
const dbMapping = require("../db/ui-db-field-mapping");
const dateFormat = require("dateformat");
const db = require("../db/db-connection");

exports.getTankMaster = async function (req, res, next) {
    try {
        const locationCode = req.user.location_code;
        
        // Get active tanks for the location
        const tanks = await TankDao.findTanks(locationCode);
        
        // Get tank-compatible products from m_product table
        const tankProducts = await db.sequelize.query(`
            SELECT DISTINCT product_code 
            FROM m_product 
            WHERE location_code = :locationCode 
              AND is_tank_product = 1 
              AND effective_end_date > CURDATE()
            ORDER BY product_code
        `, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        // Get available dip charts for dropdown
        const dipCharts = await db.sequelize.query(`
            SELECT dipchartid, chart_name, capacity_liters
            FROM m_tank_dipchart_header
            ORDER BY chart_name
        `, {
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        // Check editability for each tank
        const tanksWithEditability = await Promise.all(
            tanks.map(async (tank) => {
                const canEdit = await checkTankEditability(tank.tank_id);
                return {
                    ...tank.toJSON ? tank.toJSON() : tank,
                    canEdit: canEdit
                };
            })
        );
        
        // Prepare render data (following your JSON pattern for future API reusability)
        const renderData = {
            title: 'Tank Master',
            user: req.user,
            tanksData: JSON.stringify(tanksWithEditability),
            productsData: JSON.stringify(tankProducts.map(p => p.product_code)),
            dipChartsData: JSON.stringify(dipCharts),
            tanks: tanksWithEditability, // For direct pug access
            products: tankProducts.map(p => p.product_code), // For direct pug access
            dipCharts: dipCharts // For direct pug access
        };

        res.render('tank-master', renderData);
    } catch (error) {
        console.error('Error fetching tank master data:', error);
        next(error);
    }
};

exports.createTank = async function (req, res, next) {
    try {
        console.log('1. Starting createTank');
        const tankData = dbMapping.newTank(req);
        
        // Set default dates and audit fields
        tankData.effective_start_date = dateFormat(new Date(), "yyyy-mm-dd");
        tankData.effective_end_date = '2900-01-01';
        tankData.created_by = req.user.User_Name;
        tankData.creation_date = new Date();
        tankData.location_code = req.user.location_code;

        // Start transaction
        const t = await db.sequelize.transaction();
        
        try {
            // Check for overlapping tank codes
            const overlapping = await TankDao.checkCodeOverlap(
                null, // no tank_id for new tank
                tankData.tank_code,
                tankData.effective_start_date,
                tankData.location_code
            );

            if (overlapping) {
                throw new Error('A tank with this code already exists and is active');
            }

            // Validate tank capacity
            if (tankData.tank_orig_capacity <= 0) {
                throw new Error('Tank capacity must be greater than 0');
            }

            // Validate dead stock is not greater than capacity
            if (tankData.dead_stock && tankData.dead_stock >= tankData.tank_orig_capacity) {
                throw new Error('Dead stock cannot be greater than or equal to tank capacity');
            }

            // Save tank
            await TankDao.create(tankData, t);
            await t.commit();
            
            return res.json({
                success: true,
                message: 'Tank created successfully'
            });
        } catch (txError) {
            console.error('2. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in createTank:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create tank'
        });
    }
};

exports.updateTank = async function (req, res, next) {
    try {
        console.log('1. Starting updateTank');
        const tankId = req.params.id;
        const tankData = dbMapping.updateTank(req);
        
        tankData.updated_by = req.user.User_Name;
        tankData.updation_date = new Date();

        // Start transaction
        const t = await db.sequelize.transaction();
        
        try {
            // Verify tank exists
            const existingTank = await TankDao.findById(tankId);
            if (!existingTank) {
                return res.status(404).json({
                    success: false,
                    message: 'Tank not found'
                });
            }

            // Check if tank can be edited
            const canEdit = await checkTankEditability(tankId);
            if (!canEdit) {
                return res.status(400).json({
                    success: false,
                    message: 'Tank cannot be edited because it has active pump connections or transaction history'
                });
            }

            // Check for overlapping tank codes (excluding current tank)
            const overlapping = await TankDao.checkCodeOverlap(
                tankId,
                tankData.tank_code,
                existingTank.effective_start_date,
                existingTank.location_code
            );

            if (overlapping) {
                throw new Error('A tank with this code already exists and is active');
            }

            // Validate tank capacity
            if (tankData.tank_orig_capacity <= 0) {
                throw new Error('Tank capacity must be greater than 0');
            }

            // Validate dead stock is not greater than capacity
            if (tankData.dead_stock && tankData.dead_stock >= tankData.tank_orig_capacity) {
                throw new Error('Dead stock cannot be greater than or equal to tank capacity');
            }

            await TankDao.update(tankId, tankData, t);
            await t.commit();
            
            // Return JSON response for AJAX
            return res.json({
                success: true,
                message: 'Tank updated successfully'
            });
        } catch (txError) {
            console.error('2. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in updateTank:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update tank'
        });
    }
};

exports.deactivateTank = async function (req, res, next) {
    try {
        const tankId = req.params.id;
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        
        const t = await db.sequelize.transaction();
        
        try {
            // Verify tank exists and is active
            const existingTank = await TankDao.findById(tankId);
            if (!existingTank) {
                throw new Error('Tank not found');
            }

            const currentEndDate = new Date(existingTank.effective_end_date);
            if (currentEndDate <= new Date()) {
                throw new Error('Tank is already inactive');
            }

            // Check if tank can be deactivated
            const canEdit = await checkTankEditability(tankId);
            if (!canEdit) {
                throw new Error('Tank cannot be deactivated because it has active pump connections or recent transaction history');
            }

            await TankDao.deactivate(tankId, {
                effective_end_date: today,
                updated_by: req.user.User_Name,
                updation_date: new Date()
            }, t);
            
            await t.commit();
            
            res.json({ success: true, message: 'Tank deactivated successfully' });
        } catch (txError) {
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error deactivating tank:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to deactivate tank: ' + error.message 
        });
    }
};

exports.validateTank = async function (req, res) {
    try {
        const { tank_id, tank_code } = req.query;
        const locationCode = req.user.location_code;

        // Check for duplicate tank codes
        const overlapping = await TankDao.checkCodeOverlap(
            tank_id || null,
            tank_code,
            new Date(),
            locationCode
        );

        if (overlapping) {
            return res.json({
                valid: false,
                message: 'Tank code already exists'
            });
        }

        // Additional validations can be added here
        res.json({
            valid: true,
            message: 'Tank code is available'
        });
    } catch (error) {
        console.error('Error validating tank:', error);
        res.status(500).json({ 
            valid: false,
            message: 'Validation failed'
        });
    }
};

// Business validation function
async function checkTankEditability(tankId) {
    try {
        // Check 1: Any active pump connections?
        const pumpConnections = await db.sequelize.query(`
            SELECT COUNT(*) as count 
            FROM m_pump_tank 
            WHERE tank_id = :tankId 
              AND effective_end_date > CURDATE()
        `, {
            replacements: { tankId },
            type: db.Sequelize.QueryTypes.SELECT
        });

        if (pumpConnections[0].count > 0) {
            return false; // Has active pump connections
        }

        // Check 2: Any recent transaction history (last 30 days)?
        const recentTransactions = await db.sequelize.query(`
            SELECT 
                (SELECT COUNT(*) FROM t_tank_dip 
                 WHERE tank_id = :tankId AND dip_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) +
                (SELECT COUNT(*) FROM t_tank_stk_rcpt_dtl trd
                 INNER JOIN t_tank_stk_rcpt tr ON trd.ttank_id = tr.ttank_id
                 WHERE trd.tank_id = :tankId AND tr.decant_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) as count
        `, {
            replacements: { tankId },
            type: db.Sequelize.QueryTypes.SELECT
        });

        return recentTransactions[0].count === 0; // Can edit only if no recent transactions
    } catch (error) {
        console.error('Error checking tank editability:', error);
        return false; // Default to not editable on error
    }
}