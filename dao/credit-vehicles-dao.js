// Update your dao/credit-vehicles-dao.js

const db = require("../db/db-connection");
const CreditListVehicle = db.creditlistvehicle;
const { Op } = require("sequelize");
const dateFormat = require('dateformat');

module.exports = {
    // Find all vehicles for a credit party (UPDATE THIS METHOD)
    findAll: (creditlistId) => {
        const now = new Date();
        return db.sequelize.query(`
            SELECT 
                v.vehicle_id,
                v.creditlist_id,
                v.vehicle_number,
                v.vehicle_type,
                v.product_id,
                p.product_name,
                v.notes,
                v.created_by,
                v.updated_by,
                v.creation_date,
                v.updation_date,
                v.effective_start_date,
                v.effective_end_date
            FROM m_creditlist_vehicles v
            LEFT JOIN m_product p ON v.product_id = p.product_id
            WHERE v.creditlist_id = :creditlistId
              AND (v.effective_end_date IS NULL OR v.effective_end_date >= :now)
            ORDER BY v.vehicle_number
        `, {
            replacements: { creditlistId, now },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Find vehicle by number and customer (NEW METHOD)
    findByNumberAndCustomer: async (vehicleNumber, creditlistId) => {
    try {
        if (!vehicleNumber || !creditlistId) return null;

        const now = new Date();
        const result = await db.sequelize.query(`
            SELECT vehicle_id, vehicle_number, creditlist_id
            FROM m_creditlist_vehicles
            WHERE UPPER(TRIM(vehicle_number)) = UPPER(TRIM(:vehicleNumber))
              AND creditlist_id = :creditlistId
              AND (effective_end_date IS NULL OR effective_end_date >= :now)
            LIMIT 1
        `, {
            replacements: { vehicleNumber, creditlistId, now },
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        return result?.[0] || null;
    } catch (error) {
        console.error('Error finding vehicle by number:', error);
        throw error;
    }
},


    // Create a new vehicle (UPDATE THIS METHOD to include product_id)
  create: (vehicleData) => {
    const cleanVehicleNumber = vehicleData.vehicle_number
        ?.toUpperCase()
        .replace(/[^A-Z0-9]/g, ''); // remove all non-alphanumeric characters

    return CreditListVehicle.create({
        creditlist_id: vehicleData.creditlist_id,
        vehicle_number: cleanVehicleNumber,
        vehicle_type: vehicleData.vehicle_type, // leave exactly as selected
        product_id: vehicleData.product_id || null,
        notes: vehicleData.notes?.trim() || '',
        created_by: vehicleData.created_by,
        updated_by: vehicleData.updated_by,
        creation_date: new Date(),
        updation_date: new Date(),
        effective_start_date: new Date(),
        effective_end_date: null
    });
},

    // Update a vehicle (UPDATE THIS METHOD)
    update: (vehicleId, updatedData) => {
        return CreditListVehicle.update(updatedData, {
            where: { vehicle_id: vehicleId }
        });
    },

    // Delete a vehicle by vehicle_id (hard delete - use sparingly)
    delete: (vehicleId) => {
        return CreditListVehicle.destroy({
            where: { vehicle_id: vehicleId }
        });
    },

    // Disable a vehicle (soft delete)
    disableVehicle: (vehicleId) => {
        const now = new Date();
        const formattedDate = dateFormat(now, "yyyy-mm-dd");
        return CreditListVehicle.update({
            effective_end_date: formattedDate,
            updation_date: now
        }, {
            where: { vehicle_id: vehicleId }
        });
    },

    // Enable a vehicle
    enableVehicle: (vehicleId) => {
        const updateDate = "2400-01-01";
        return CreditListVehicle.update({
            effective_end_date: updateDate,
            updation_date: new Date()
        }, {
            where: { vehicle_id: vehicleId }
        });
    },

    // Get count of vehicles for a credit party
    getVehicleCount: (creditlistId) => {
        return CreditListVehicle.count({
            where: { 
                creditlist_id: creditlistId,
                [Op.or]: [
                    { effective_end_date: null },
                    { effective_end_date: { [Op.gt]: new Date() } }
                ]
            }
        });
    },

    findAllVehiclesForLocation: (locationCode) => {
    return db.sequelize.query(
        `SELECT 
            v.vehicle_id,
            v.creditlist_id,
            v.vehicle_number,
            v.vehicle_type,
            c.Company_Name as company_name
        FROM m_creditlist_vehicles v
        INNER JOIN m_credit_list c ON v.creditlist_id = c.creditlist_id
        WHERE c.location_code = :locationCode
            AND (v.effective_end_date IS NULL OR v.effective_end_date >= CURDATE())
            AND (c.effective_end_date IS NULL OR c.effective_end_date >= CURDATE())
        ORDER BY v.vehicle_number`,
        {
            replacements: { locationCode },
            type: db.sequelize.QueryTypes.SELECT
        }
    );
},

findByVehicleIds: (vehicleIds) => {
        return CreditListVehicle.findAll({
            where: { 
                vehicle_id: vehicleIds
            },
            attributes: ['vehicle_id', 'vehicle_number', 'vehicle_type', 'creditlist_id']
        });
    },

// Find disabled vehicles for a credit party
findDisabled: (creditlistId) => {
    const now = new Date();
    return db.sequelize.query(`
        SELECT 
            v.vehicle_id,
            v.creditlist_id,
            v.vehicle_number,
            v.vehicle_type,
            v.product_id,
            p.product_name,
            v.notes,
            v.created_by,
            v.updated_by,
            v.creation_date,
            v.updation_date,
            v.effective_start_date,
            v.effective_end_date
        FROM m_creditlist_vehicles v
        LEFT JOIN m_product p ON v.product_id = p.product_id
        WHERE v.creditlist_id = :creditlistId
          AND v.effective_end_date IS NOT NULL 
          AND v.effective_end_date < :now
        ORDER BY v.vehicle_number
    `, {
        replacements: { creditlistId, now },
        type: db.Sequelize.QueryTypes.SELECT
    });
},    

};