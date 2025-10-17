// controllers/masters/pump-tank-controller.js
const db = require('../db/db-connection');
const personDao = require('../dao/person-dao');
const { QueryTypes } = require('sequelize');

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
    }
};