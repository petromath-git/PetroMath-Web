// controllers/masters/pump-tank-controller.js
const db = require('../db/db-connection');
const personDao = require('../dao/person-dao');
const { QueryTypes } = require('sequelize');




// Validation helpers
function validateTankCode(tankCode) {
    // Only alphanumeric and hyphen, max 10 characters
    const tankCodeRegex = /^[A-Z0-9-]{1,10}$/;
    
    if (!tankCode) {
        return { valid: false, error: 'Tank code is required' };
    }
    
    if (tankCode.length > 10) {
        return { valid: false, error: 'Tank code must be 10 characters or less' };
    }
    
    if (!tankCodeRegex.test(tankCode)) {
        return { valid: false, error: 'Tank code can only contain letters, numbers, and hyphens (no spaces or special characters)' };
    }
    
    return { valid: true };
}

function validateTankNumbers(capacity, openingStock, deadStock) {
    // Check for negative values 
    if (Number(capacity) < 0 || Number(openingStock) < 0 || Number(deadStock) < 0) {
        return { valid: false, error: 'Capacity, opening stock, and dead stock cannot be negative' };
    }
    
    
    // Check if whole numbers
    if (!Number.isInteger(Number(capacity)) || !Number.isInteger(Number(openingStock)) || !Number.isInteger(Number(deadStock))) {
        return { valid: false, error: 'Capacity, opening stock, and dead stock must be whole numbers' };
    }
    
    // Check max 5 digits
    if (capacity > 99999 || openingStock > 99999 || deadStock > 99999) {
        return { valid: false, error: 'Capacity, opening stock, and dead stock cannot exceed 99999 (5 digits)' };
    }
    
    // Check opening stock <= capacity
    if (Number(openingStock) > Number(capacity)) {
        return { valid: false, error: 'Opening stock cannot be greater than tank capacity' };
    }
    
    // Check dead stock <= capacity
    if (Number(deadStock) > Number(capacity)) {
        return { valid: false, error: 'Dead stock cannot be greater than tank capacity' };
    }
    
    // Check dead stock <= opening stock (optional business rule)
    if (Number(deadStock) > Number(openingStock)) {
        return { valid: false, error: 'Dead stock cannot be greater than opening stock' };
    }
    
    return { valid: true };
}


// ==================== PUMP CRUD VALIDATION ====================

// Validation helper for pump code
function validatePumpCode(pumpCode) {
    const pumpCodeRegex = /^[A-Z0-9-]{1,10}$/;
    
    if (!pumpCode) {
        return { valid: false, error: 'Pump code is required' };
    }
    
    if (pumpCode.length > 10) {
        return { valid: false, error: 'Pump code must be 10 characters or less' };
    }
    
    if (!pumpCodeRegex.test(pumpCode)) {
        return { valid: false, error: 'Pump code can only contain letters, numbers, and hyphens (no spaces or special characters)' };
    }
    
    return { valid: true };
}

function validatePumpNumbers(openingReading, displayOrder) {
    // Check for negative values
    if (Number(openingReading) < 0 || Number(displayOrder) < 0) {
        return { valid: false, error: 'Opening reading and display order cannot be negative' };
    }
    
    // Validate opening reading (decimal with 3 places)
    const openingReadingNum = Number(openingReading);
    if (openingReadingNum > 999999.999) {
        return { valid: false, error: 'Opening reading cannot exceed 999999.999' };
    }
    
    // Check decimal places (max 3)
    const decimalPlaces = (openingReading.toString().split('.')[1] || '').length;
    if (decimalPlaces > 3) {
        return { valid: false, error: 'Opening reading can have maximum 3 decimal places' };
    }
    
    // Validate display order (whole number, 1-999)
    if (!Number.isInteger(Number(displayOrder))) {
        return { valid: false, error: 'Display order must be a whole number' };
    }
    
    if (displayOrder < 1 || displayOrder > 999) {
        return { valid: false, error: 'Display order must be between 1 and 999' };
    }
    
    return { valid: true };
}

function validateStampingDate(stampingDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stamping = new Date(stampingDate);
    stamping.setHours(0, 0, 0, 0);
    
    if (stamping > today) {
        return { valid: false, error: 'Stamping date cannot be in the future' };
    }
    
    return { valid: true };
}

// ==================== PUMP-TANK RELATIONSHIP CRUD OPERATIONS ====================

// Validation for relationship dates
function validateRelationshipDates(effectiveStartDate, effectiveEndDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDate = new Date(effectiveStartDate);
    startDate.setHours(0, 0, 0, 0);
    
    // Start date cannot be in future
    if (startDate > today) {
        return { valid: false, error: 'Effective start date cannot be in the future' };
    }
    
    // If end date provided, validate it
    if (effectiveEndDate) {
        const endDate = new Date(effectiveEndDate);
        endDate.setHours(0, 0, 0, 0);
        
        // End date must be >= start date
        if (endDate < startDate) {
            return { valid: false, error: 'Effective end date cannot be before start date' };
        }
    }
    
    return { valid: true };
}


module.exports = {
    // Main page renderer - loads the tabbed interface
    renderPumpTankMaster: async (req, res, next) => {
        try {
            const userPersonId = req.user.Person_id;
            const userRole = req.user.Role;
            
            // Get user's accessible locations with names
            const accessibleLocations = await personDao.getUserAccessibleLocationsWithNames(userPersonId);
            
            // Default to first accessible location or user's primary location
            const defaultLocation = req.query.location_code || 
                                  accessibleLocations[0]?.location_code || 
                                  req.user.location_code;
            
            res.render('pump-tank-master', {
                title: 'Pump & Tank Master',
                user: req.user,
                locations: accessibleLocations,
                selectedLocation: defaultLocation
            });
            
        } catch (error) {
            console.error('Error rendering pump-tank master:', error);
            next(error);
        }
    },
    
    // Get tanks for selected location
    getTanks: async (req, res) => {
        try {
            const locationCode = req.query.location_code || req.user.location_code;
            
            const query = `
                SELECT 
                    t.tank_id,
                    t.tank_code,
                    t.product_code,
                    t.tank_orig_capacity,
                    t.tank_opening_stock,
                    t.dead_stock,
                    t.dipchartid,
                    t.effective_start_date,
                    t.effective_end_date,
                    p.product_name,
                    p.rgb_color
                FROM m_tank t
                LEFT JOIN m_product p ON t.product_code = p.product_name 
                    AND p.location_code = t.location_code
                    AND p.is_tank_product = 1
                WHERE t.location_code = :locationCode
                  AND t.effective_end_date >= CURDATE()
                ORDER BY t.tank_code
            `;
            
            const tanks = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: QueryTypes.SELECT
            });
            
            res.json({ success: true, tanks });
            
        } catch (error) {
            console.error('Error fetching tanks:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },
    
    // Get pumps for selected location
    getPumps: async (req, res) => {
        try {
            const locationCode = req.query.location_code || req.user.location_code;
            
            const query = `
                SELECT 
                    p.pump_id,
                    p.pump_code,
                    p.pump_make,
                    p.product_code,
                    p.opening_reading,
                    p.display_order,
                    p.current_stamping_date,
                    p.Stamping_due,
                    p.effective_start_date,
                    p.effective_end_date,
                    prod.product_name,
                    prod.rgb_color
                FROM m_pump p
                LEFT JOIN m_product prod ON p.product_code = prod.product_name 
                    AND prod.location_code = p.location_code
                    AND prod.is_tank_product = 1
                WHERE p.location_code = :locationCode
                  AND p.effective_end_date >= CURDATE()
                ORDER BY p.display_order, p.pump_code
            `;
            
            const pumps = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: QueryTypes.SELECT
            });
            
            res.json({ success: true, pumps });
            
        } catch (error) {
            console.error('Error fetching pumps:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },
    
    // Get pump-tank relations for selected location
    getPumpTankRelations: async (req, res) => {
        try {
            const locationCode = req.query.location_code || req.user.location_code;
            
            const query = `
                SELECT 
                    pt.pump_tank_id,
                    pt.pump_id,
                    pt.tank_id,
                    pt.effective_start_date,
                    pt.effective_end_date,
                    p.pump_code,
                    p.product_code as pump_product,
                    t.tank_code,
                    t.product_code as tank_product
                FROM m_pump_tank pt
                JOIN m_pump p ON pt.pump_id = p.pump_id
                JOIN m_tank t ON pt.tank_id = t.tank_id
                WHERE pt.location_code = :locationCode
                  AND pt.effective_end_date >= CURDATE()
                ORDER BY p.pump_code, t.tank_code
            `;
            
            const relations = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: QueryTypes.SELECT
            });
            
            res.json({ success: true, relations });
            
        } catch (error) {
            console.error('Error fetching pump-tank relations:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },
    
    // Get products for dropdowns (only tank products)
    getProducts: async (req, res) => {
        try {
            const locationCode = req.query.location_code || req.user.location_code;
            
            const query = `
                SELECT 
                    product_name,
                    rgb_color,
                    sku_name
                FROM m_product
                WHERE location_code = :locationCode
                  AND is_tank_product = 1
                ORDER BY product_name
            `;
            
            const products = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: QueryTypes.SELECT
            });
            
            res.json({ success: true, products });
            
        } catch (error) {
            console.error('Error fetching products:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

// Create new tank
createTank: async (req, res) => {
    try {
        const {
            tank_code,
            product_code,
            tank_orig_capacity,
            tank_opening_stock,
            dead_stock,
            location_code
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!tank_code || !product_code || !tank_orig_capacity || !location_code) {
            return res.status(400).json({
                success: false,
                error: 'Tank code, product, capacity, and location are required'
            });
        }

         // Validate tank code format - ADD THIS
        const tankCodeValidation = validateTankCode(tank_code.toUpperCase());
        if (!tankCodeValidation.valid) {
            return res.status(400).json({
                success: false,
                error: tankCodeValidation.error
            });
        }

        // Validate numbers - ADD THIS
        const numbersValidation = validateTankNumbers(
            tank_orig_capacity, 
            tank_opening_stock || 0, 
            dead_stock || 0
        );
        if (!numbersValidation.valid) {
            return res.status(400).json({
                success: false,
                error: numbersValidation.error
            });
        }
        
        // Check for duplicate tank code at location
        const duplicateCheck = await db.sequelize.query(`
            SELECT tank_id FROM m_tank 
            WHERE tank_code = :tank_code 
            AND location_code = :location_code
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { tank_code, location_code },
            type: QueryTypes.SELECT
        });
        
        if (duplicateCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Tank code already exists at this location'
            });
        }
        
        // Insert new tank
        const insertQuery = `
            INSERT INTO m_tank (
                tank_code,
                product_code,
                location_code,
                tank_orig_capacity,
                tank_opening_stock,
                dead_stock,
                effective_start_date,
                effective_end_date,
                created_by,
                updated_by,
                creation_date,
                updation_date
            ) VALUES (
                :tank_code,
                :product_code,
                :location_code,
                :tank_orig_capacity,
                :tank_opening_stock,
                :dead_stock,
                CURDATE(),
                '2099-12-31',
                :created_by,
                :updated_by,
                NOW(),
                NOW()
            )
        `;
        
        await db.sequelize.query(insertQuery, {
            replacements: {
                tank_code: tank_code.toUpperCase(),
                product_code,
                location_code,
                tank_orig_capacity,
                tank_opening_stock: tank_opening_stock || 0,
                dead_stock: dead_stock || 0,
                created_by: userId,
                updated_by: userId
            },
            type: QueryTypes.INSERT
        });
        
        res.json({ success: true, message: 'Tank created successfully' });
        
    } catch (error) {
        console.error('Error creating tank:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Update existing tank
updateTank: async (req, res) => {
    try {
        const tankId = req.params.id;
        const {
            tank_code,
            product_code,
            tank_orig_capacity,
            tank_opening_stock,
            dead_stock
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!tank_code || !product_code || !tank_orig_capacity) {
            return res.status(400).json({
                success: false,
                error: 'Tank code, product, and capacity are required'
            });
        }


        // Validate tank code format 
        const tankCodeValidation = validateTankCode(tank_code.toUpperCase());
        if (!tankCodeValidation.valid) {
            return res.status(400).json({
                success: false,
                error: tankCodeValidation.error
            });
        }

        // Check for duplicate tank code at location (excluding current tank) - ADD THIS
        const duplicateCheck = await db.sequelize.query(`
            SELECT tank_id FROM m_tank 
            WHERE tank_code = :tank_code 
            AND location_code = (SELECT location_code FROM m_tank WHERE tank_id = :tank_id)
            AND tank_id != :tank_id
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { tank_code: tank_code.toUpperCase(), tank_id: tankId },
            type: QueryTypes.SELECT
        });

        if (duplicateCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Tank code already exists at this location'
            });
        }

        // Validate numbers - ADD THIS
        const numbersValidation = validateTankNumbers(
            tank_orig_capacity, 
            tank_opening_stock || 0, 
            dead_stock || 0
        );
        if (!numbersValidation.valid) {
            return res.status(400).json({
                success: false,
                error: numbersValidation.error
            });
        }

        
        // Update tank
        const updateQuery = `
            UPDATE m_tank
            SET tank_code = :tank_code,
                product_code = :product_code,
                tank_orig_capacity = :tank_orig_capacity,
                tank_opening_stock = :tank_opening_stock,
                dead_stock = :dead_stock,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE tank_id = :tank_id
        `;
        
        await db.sequelize.query(updateQuery, {
            replacements: {
                tank_id: tankId,
                tank_code: tank_code.toUpperCase(),
                product_code,
                tank_orig_capacity,
                tank_opening_stock: tank_opening_stock || 0,
                dead_stock: dead_stock || 0,
                updated_by: userId
            },
            type: QueryTypes.UPDATE
        });
        
        res.json({ success: true, message: 'Tank updated successfully' });
        
    } catch (error) {
        console.error('Error updating tank:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Deactivate tank
deactivateTank: async (req, res) => {
    try {
        const tankId = req.params.id;
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Check if tank has active pump links
        const linkCheck = await db.sequelize.query(`
            SELECT COUNT(*) as count FROM m_pump_tank
            WHERE tank_id = :tank_id
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { tank_id: tankId },
            type: QueryTypes.SELECT
        });
        
        if (linkCheck[0].count > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot deactivate tank. It has active pump links. Please remove pump links first.'
            });
        }
        
        // Deactivate tank
        const deactivateQuery = `
            UPDATE m_tank
            SET effective_end_date = CURDATE(),
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE tank_id = :tank_id
        `;
        
        await db.sequelize.query(deactivateQuery, {
            replacements: {
                tank_id: tankId,
                updated_by: userId
            },
            type: QueryTypes.UPDATE
        });
        
        res.json({ success: true, message: 'Tank deactivated successfully' });
        
    } catch (error) {
        console.error('Error deactivating tank:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Get single tank details (for edit modal)
getTankById: async (req, res) => {
    try {
        const tankId = req.params.id;
        
        const query = `
            SELECT 
                t.tank_id,
                t.tank_code,
                t.product_code,
                t.tank_orig_capacity,
                t.tank_opening_stock,
                t.dead_stock,
                t.location_code,
                t.effective_start_date,
                t.effective_end_date
            FROM m_tank t
            WHERE t.tank_id = :tankId
        `;
        
        const tank = await db.sequelize.query(query, {
            replacements: { tankId },
            type: QueryTypes.SELECT
        });
        
        if (tank.length === 0) {
            return res.status(404).json({ success: false, error: 'Tank not found' });
        }
        
        res.json({ success: true, tank: tank[0] });
        
    } catch (error) {
        console.error('Error fetching tank:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},
// Create new pump
createPump: async (req, res) => {
    try {
        const {
            pump_code,
            pump_make,
            product_code,
            opening_reading,
            display_order,
            current_stamping_date,
            location_code
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!pump_code || !product_code || opening_reading === undefined || !display_order || !current_stamping_date || !location_code) {
            return res.status(400).json({
                success: false,
                error: 'Pump code, product, opening reading, display order, stamping date, and location are required'
            });
        }
        
        // Validate pump code format
        const pumpCodeValidation = validatePumpCode(pump_code.toUpperCase());
        if (!pumpCodeValidation.valid) {
            return res.status(400).json({
                success: false,
                error: pumpCodeValidation.error
            });
        }
        
        // Validate pump make length
        if (pump_make && pump_make.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'Pump make cannot exceed 50 characters'
            });
        }
        
        // Validate numbers
        const numbersValidation = validatePumpNumbers(opening_reading, display_order);
        if (!numbersValidation.valid) {
            return res.status(400).json({
                success: false,
                error: numbersValidation.error
            });
        }
        
        // Validate stamping date
        const stampingValidation = validateStampingDate(current_stamping_date);
        if (!stampingValidation.valid) {
            return res.status(400).json({
                success: false,
                error: stampingValidation.error
            });
        }
        
        // Check for duplicate pump code at location
        const duplicateCheck = await db.sequelize.query(`
            SELECT pump_id FROM m_pump 
            WHERE pump_code = :pump_code 
            AND location_code = :location_code
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { pump_code: pump_code.toUpperCase(), location_code },
            type: QueryTypes.SELECT
        });
        
        if (duplicateCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Pump code already exists at this location'
            });
        }
        
        // Check for duplicate display order at location
        const displayOrderCheck = await db.sequelize.query(`
            SELECT pump_id FROM m_pump 
            WHERE display_order = :display_order 
            AND location_code = :location_code
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { display_order, location_code },
            type: QueryTypes.SELECT
        });
        
        if (displayOrderCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Display order already exists at this location'
            });
        }
        
        // Calculate stamping due date (1 year from stamping date)
        const stampingDue = new Date(current_stamping_date);
        stampingDue.setFullYear(stampingDue.getFullYear() + 1);
        
        // Insert new pump
        const insertQuery = `
            INSERT INTO m_pump (
                pump_code,
                pump_make,
                product_code,
                opening_reading,
                location_code,
                display_order,
                current_stamping_date,
                Stamping_due,
                effective_start_date,
                effective_end_date,
                created_by,
                updated_by,
                creation_date,
                updation_date
            ) VALUES (
                :pump_code,
                :pump_make,
                :product_code,
                :opening_reading,
                :location_code,
                :display_order,
                :current_stamping_date,
                :stamping_due,
                CURDATE(),
                '2099-12-31',
                :created_by,
                :updated_by,
                NOW(),
                NOW()
            )
        `;
        
        await db.sequelize.query(insertQuery, {
            replacements: {
                pump_code: pump_code.toUpperCase(),
                pump_make: pump_make || null,
                product_code,
                opening_reading,
                location_code,
                display_order,
                current_stamping_date,
                stamping_due: stampingDue.toISOString().split('T')[0],
                created_by: userId,
                updated_by: userId
            },
            type: QueryTypes.INSERT
        });
        
        res.json({ success: true, message: 'Pump created successfully' });
        
    } catch (error) {
        console.error('Error creating pump:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Update existing pump
updatePump: async (req, res) => {
    try {
        const pumpId = req.params.id;
        const {
            pump_code,
            pump_make,
            product_code,
            opening_reading,
            display_order,
            current_stamping_date
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!pump_code || !product_code || opening_reading === undefined || !display_order || !current_stamping_date) {
            return res.status(400).json({
                success: false,
                error: 'Pump code, product, opening reading, display order, and stamping date are required'
            });
        }
        
        // Validate pump code format
        const pumpCodeValidation = validatePumpCode(pump_code.toUpperCase());
        if (!pumpCodeValidation.valid) {
            return res.status(400).json({
                success: false,
                error: pumpCodeValidation.error
            });
        }
        
        // Validate pump make length
        if (pump_make && pump_make.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'Pump make cannot exceed 50 characters'
            });
        }
        
        // Validate numbers
        const numbersValidation = validatePumpNumbers(opening_reading, display_order);
        if (!numbersValidation.valid) {
            return res.status(400).json({
                success: false,
                error: numbersValidation.error
            });
        }
        
        // Validate stamping date
        const stampingValidation = validateStampingDate(current_stamping_date);
        if (!stampingValidation.valid) {
            return res.status(400).json({
                success: false,
                error: stampingValidation.error
            });
        }
        
        // Check for duplicate pump code at location (excluding current pump)
        const duplicateCheck = await db.sequelize.query(`
            SELECT pump_id FROM m_pump 
            WHERE pump_code = :pump_code 
            AND location_code = (SELECT location_code FROM m_pump WHERE pump_id = :pump_id)
            AND pump_id != :pump_id
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { pump_code: pump_code.toUpperCase(), pump_id: pumpId },
            type: QueryTypes.SELECT
        });
        
        if (duplicateCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Pump code already exists at this location'
            });
        }
        
        // Check for duplicate display order at location (excluding current pump)
        const displayOrderCheck = await db.sequelize.query(`
            SELECT pump_id FROM m_pump 
            WHERE display_order = :display_order 
            AND location_code = (SELECT location_code FROM m_pump WHERE pump_id = :pump_id)
            AND pump_id != :pump_id
            AND effective_end_date >= CURDATE()
        `, {
            replacements: { display_order, pump_id: pumpId },
            type: QueryTypes.SELECT
        });
        
        if (displayOrderCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Display order already exists at this location'
            });
        }
        
        // Calculate stamping due date (1 year from stamping date)
        const stampingDue = new Date(current_stamping_date);
        stampingDue.setFullYear(stampingDue.getFullYear() + 1);
        
        // Update pump
        const updateQuery = `
            UPDATE m_pump
            SET pump_code = :pump_code,
                pump_make = :pump_make,
                product_code = :product_code,
                opening_reading = :opening_reading,
                display_order = :display_order,
                current_stamping_date = :current_stamping_date,
                Stamping_due = :stamping_due,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE pump_id = :pump_id
        `;
        
        await db.sequelize.query(updateQuery, {
            replacements: {
                pump_id: pumpId,
                pump_code: pump_code.toUpperCase(),
                pump_make: pump_make || null,
                product_code,
                opening_reading,
                display_order,
                current_stamping_date,
                stamping_due: stampingDue.toISOString().split('T')[0],
                updated_by: userId
            },
            type: QueryTypes.UPDATE
        });
        
        res.json({ success: true, message: 'Pump updated successfully' });
        
    } catch (error) {
        console.error('Error updating pump:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Get single pump details (for edit modal)
getPumpById: async (req, res) => {
    try {
        const pumpId = req.params.id;
        
        const query = `
            SELECT 
                p.pump_id,
                p.pump_code,
                p.pump_make,
                p.product_code,
                p.opening_reading,
                p.display_order,
                p.current_stamping_date,
                p.Stamping_due,
                p.location_code,
                p.effective_start_date,
                p.effective_end_date
            FROM m_pump p
            WHERE p.pump_id = :pumpId
        `;
        
        const pump = await db.sequelize.query(query, {
            replacements: { pumpId },
            type: QueryTypes.SELECT
        });
        
        if (pump.length === 0) {
            return res.status(404).json({ success: false, error: 'Pump not found' });
        }
        
        res.json({ success: true, pump: pump[0] });
        
    } catch (error) {
        console.error('Error fetching pump:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Create new pump-tank relationship
createRelation: async (req, res) => {
    try {
        const {
            pump_id,
            tank_id,
            effective_start_date,
            location_code
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!pump_id || !tank_id || !effective_start_date || !location_code) {
            return res.status(400).json({
                success: false,
                error: 'Pump, tank, effective start date, and location are required'
            });
        }
        
        // Validate dates
        const dateValidation = validateRelationshipDates(effective_start_date, null);
        if (!dateValidation.valid) {
            return res.status(400).json({
                success: false,
                error: dateValidation.error
            });
        }
        
        // Get pump and tank details to validate product match
        const pumpTankCheck = await db.sequelize.query(`
            SELECT 
                p.pump_code,
                p.product_code as pump_product,
                t.tank_code,
                t.product_code as tank_product
            FROM m_pump p, m_tank t
            WHERE p.pump_id = :pump_id
              AND t.tank_id = :tank_id
        `, {
            replacements: { pump_id, tank_id },
            type: QueryTypes.SELECT
        });
        
        if (pumpTankCheck.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid pump or tank selected'
            });
        }
        
        const pumpCode = pumpTankCheck[0].pump_code;
        const tankCode = pumpTankCheck[0].tank_code;
        const pumpProduct = pumpTankCheck[0].pump_product;
        const tankProduct = pumpTankCheck[0].tank_product;
        
        // Validate product match
        if (pumpProduct !== tankProduct) {
            return res.status(400).json({
                success: false,
                error: `Product mismatch: Pump ${pumpCode} has product ${pumpProduct}, but Tank ${tankCode} has product ${tankProduct}`
            });
        }
        
        // Check if pump already has an active link on the same date
        const existingLinkCheck = await db.sequelize.query(`
            SELECT 
                pt.pump_tank_id,
                t.tank_code
            FROM m_pump_tank pt
            JOIN m_tank t ON pt.tank_id = t.tank_id
            WHERE pt.pump_id = :pump_id
              AND :effective_start_date BETWEEN pt.effective_start_date AND pt.effective_end_date
        `, {
            replacements: { pump_id, effective_start_date },
            type: QueryTypes.SELECT
        });
        
        if (existingLinkCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Pump ${pumpCode} is already linked to Tank ${existingLinkCheck[0].tank_code} for the selected date. Please remove the existing link first.`
            });
        }
        
        // Insert new relationship
        const insertQuery = `
            INSERT INTO m_pump_tank (
                pump_id,
                tank_id,
                location_code,
                effective_start_date,
                effective_end_date,
                created_by,
                updated_by,
                creation_date,
                updation_date
            ) VALUES (
                :pump_id,
                :tank_id,
                :location_code,
                :effective_start_date,
                '2099-12-31',
                :created_by,
                :updated_by,
                NOW(),
                NOW()
            )
        `;
        
        await db.sequelize.query(insertQuery, {
            replacements: {
                pump_id,
                tank_id,
                location_code,
                effective_start_date,
                created_by: userId,
                updated_by: userId
            },
            type: QueryTypes.INSERT
        });
        
        res.json({ success: true, message: 'Pump-tank relationship created successfully' });
        
    } catch (error) {
        console.error('Error creating relationship:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Update relationship (only dates)
updateRelation: async (req, res) => {
    try {
        const relationId = req.params.id;
        const {
            effective_start_date,
            effective_end_date
        } = req.body;
        
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // Validate required fields
        if (!effective_start_date) {
            return res.status(400).json({
                success: false,
                error: 'Effective start date is required'
            });
        }
        
        // Validate dates
        const dateValidation = validateRelationshipDates(effective_start_date, effective_end_date);
        if (!dateValidation.valid) {
            return res.status(400).json({
                success: false,
                error: dateValidation.error
            });
        }
        
        // Get current relationship details
        const currentRelation = await db.sequelize.query(`
            SELECT pump_id, tank_id FROM m_pump_tank WHERE pump_tank_id = :relationId
        `, {
            replacements: { relationId },
            type: QueryTypes.SELECT
        });
        
        if (currentRelation.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Relationship not found'
            });
        }
        
        const pumpId = currentRelation[0].pump_id;
        
        // Check for date overlap with other relations of same pump
        const overlapCheck = await db.sequelize.query(`
            SELECT 
                pt.pump_tank_id,
                t.tank_code
            FROM m_pump_tank pt
            JOIN m_tank t ON pt.tank_id = t.tank_id
            WHERE pt.pump_id = :pump_id
              AND pt.pump_tank_id != :relationId
              AND (
                  (:effective_start_date BETWEEN pt.effective_start_date AND pt.effective_end_date)
                  OR 
                  (:effective_end_date BETWEEN pt.effective_start_date AND pt.effective_end_date)
                  OR
                  (pt.effective_start_date BETWEEN :effective_start_date AND :effective_end_date)
              )
        `, {
            replacements: { 
                pump_id: pumpId, 
                relationId, 
                effective_start_date,
                effective_end_date: effective_end_date || '2099-12-31'
            },
            type: QueryTypes.SELECT
        });
        
        if (overlapCheck.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Date overlap detected with another relationship to Tank ${overlapCheck[0].tank_code}`
            });
        }
        
        // Update relationship
        const updateQuery = `
            UPDATE m_pump_tank
            SET effective_start_date = :effective_start_date,
                effective_end_date = :effective_end_date,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE pump_tank_id = :relationId
        `;
        
        await db.sequelize.query(updateQuery, {
            replacements: {
                relationId,
                effective_start_date,
                effective_end_date: effective_end_date || '2099-12-31',
                updated_by: userId
            },
            type: QueryTypes.UPDATE
        });
        
        res.json({ success: true, message: 'Relationship updated successfully' });
        
    } catch (error) {
        console.error('Error updating relationship:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Deactivate relationship
deactivateRelation: async (req, res) => {
    try {
        const relationId = req.params.id;
        const { effective_end_date } = req.body;
        const userId = req.user.Person_Name || req.user.User_Name;
        
        // If no end date provided, use today
        const endDate = effective_end_date || new Date().toISOString().split('T')[0];
        
        // Get relationship start date to validate
        const relationCheck = await db.sequelize.query(`
            SELECT effective_start_date FROM m_pump_tank WHERE pump_tank_id = :relationId
        `, {
            replacements: { relationId },
            type: QueryTypes.SELECT
        });
        
        if (relationCheck.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Relationship not found'
            });
        }
        
        // Validate end date is not before start date
        const startDate = new Date(relationCheck[0].effective_start_date);
        const end = new Date(endDate);
        
        if (end < startDate) {
            return res.status(400).json({
                success: false,
                error: 'End date cannot be before start date'
            });
        }
        
        // Validate end date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        
        if (end > today) {
            return res.status(400).json({
                success: false,
                error: 'End date cannot be in the future'
            });
        }
        
        // Deactivate relationship
        const deactivateQuery = `
            UPDATE m_pump_tank
            SET effective_end_date = :effective_end_date,
                updated_by = :updated_by,
                updation_date = NOW()
            WHERE pump_tank_id = :relationId
        `;
        
        await db.sequelize.query(deactivateQuery, {
            replacements: {
                relationId,
                effective_end_date: endDate,
                updated_by: userId
            },
            type: QueryTypes.UPDATE
        });
        
        res.json({ success: true, message: 'Relationship deactivated successfully' });
        
    } catch (error) {
        console.error('Error deactivating relationship:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Get single relationship details (for edit modal)
getRelationById: async (req, res) => {
    try {
        const relationId = req.params.id;
        
        const query = `
            SELECT 
                pt.pump_tank_id,
                pt.pump_id,
                pt.tank_id,
                pt.effective_start_date,
                pt.effective_end_date,
                p.pump_code,
                p.product_code as pump_product,
                t.tank_code,
                t.product_code as tank_product
            FROM m_pump_tank pt
            JOIN m_pump p ON pt.pump_id = p.pump_id
            JOIN m_tank t ON pt.tank_id = t.tank_id
            WHERE pt.pump_tank_id = :relationId
        `;
        
        const relation = await db.sequelize.query(query, {
            replacements: { relationId },
            type: QueryTypes.SELECT
        });
        
        if (relation.length === 0) {
            return res.status(404).json({ success: false, error: 'Relationship not found' });
        }
        
        res.json({ success: true, relation: relation[0] });
        
    } catch (error) {
        console.error('Error fetching relationship:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Get available pumps for linking (not already linked on a date)
getAvailablePumps: async (req, res) => {
    try {
        const locationCode = req.query.location_code;
        const effectiveDate = req.query.effective_date || new Date().toISOString().split('T')[0];
        
        const query = `
            SELECT 
                p.pump_id,
                p.pump_code,
                p.product_code
            FROM m_pump p
            WHERE p.location_code = :locationCode
              AND p.effective_end_date >= CURDATE()
              AND NOT EXISTS (
                  SELECT 1 FROM m_pump_tank pt
                  WHERE pt.pump_id = p.pump_id
                    AND :effectiveDate BETWEEN pt.effective_start_date AND pt.effective_end_date
              )
            ORDER BY p.pump_code
        `;
        
        const pumps = await db.sequelize.query(query, {
            replacements: { locationCode, effectiveDate },
            type: QueryTypes.SELECT
        });
        
        res.json({ success: true, pumps });
        
    } catch (error) {
        console.error('Error fetching available pumps:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

// Get available tanks for a specific pump (same product)
getAvailableTanks: async (req, res) => {
    try {
        const locationCode = req.query.location_code;
        const pumpId = req.query.pump_id;
        
        if (!pumpId) {
            return res.json({ success: true, tanks: [] });
        }
        
        const query = `
            SELECT 
                t.tank_id,
                t.tank_code,
                t.product_code
            FROM m_tank t
            WHERE t.location_code = :locationCode
              AND t.effective_end_date >= CURDATE()
              AND t.product_code = (
                  SELECT product_code FROM m_pump WHERE pump_id = :pumpId
              )
            ORDER BY t.tank_code
        `;
        
        const tanks = await db.sequelize.query(query, {
            replacements: { locationCode, pumpId },
            type: QueryTypes.SELECT
        });
        
        res.json({ success: true, tanks });
        
    } catch (error) {
        console.error('Error fetching available tanks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
},

};
