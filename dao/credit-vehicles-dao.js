const db = require("../db/db-connection");
const CreditListVehicle = db.creditlistvehicle;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");
const config = require("../config/app-config");
const utils = require('../utils/app-utils');
const dateFormat = require('dateformat');

module.exports = {
    // Get all vehicles for a given credit party (only active vehicles)
    findAll: (creditlistId) => {
        if (creditlistId) {
            return CreditListVehicle.findAll({
                where: { 
                    creditlist_id: creditlistId,
                    [Op.or]: [
                        { effective_end_date: null },
                        { effective_end_date: { [Op.gt]: new Date() } }
                    ]
                },
                order: [Sequelize.literal('vehicle_number')]
            });
        } else {
            return CreditListVehicle.findAll({
                where: {
                    [Op.or]: [
                        { effective_end_date: null },
                        { effective_end_date: { [Op.gt]: new Date() } }
                    ]
                }
            });
        }
    },

    // Get all vehicles including disabled ones (for enable vehicle page)
    findAllIncludingDisabled: (creditlistId) => {
        if (creditlistId) {
            return CreditListVehicle.findAll({
                where: { creditlist_id: creditlistId },
                order: [Sequelize.literal('vehicle_number')]
            });
        } else {
            return CreditListVehicle.findAll({});
        }
    },

    // Get disabled vehicles only
    findDisabled: (creditlistId) => {
        const whereClause = {
            effective_end_date: { [Op.lte]: new Date() }
        };
        
        if (creditlistId) {
            whereClause.creditlist_id = creditlistId;
        }

        return CreditListVehicle.findAll({
            where: whereClause,
            order: [Sequelize.literal('vehicle_number')]
        });
    },

    // Get vehicles linked to a specific credit party and location (optional filter by location)
    findByCreditlistAndLocation: (creditlistId, locationCode) => {
        if (creditlistId && locationCode) {
            return CreditListVehicle.findAll({
                where: {
                    creditlist_id: creditlistId,
                    location_code: locationCode,
                    [Op.or]: [
                        { effective_end_date: null },
                        { effective_end_date: { [Op.gt]: new Date() } }
                    ]
                },
                order: [Sequelize.literal('vehicle_number')]
            });
        } else {
            return CreditListVehicle.findAll({
                where: {
                    [Op.or]: [
                        { effective_end_date: null },
                        { effective_end_date: { [Op.gt]: new Date() } }
                    ]
                }
            });
        }
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

    // Get vehicle details by vehicle_id
    findByVehicleId: (vehicleId) => {
        return CreditListVehicle.findOne({
            where: { vehicle_id: vehicleId }
        });
    },


    findByVehicleIds: (vehicleIds) => {
        return CreditListVehicle.findAll({
            where: { 
                vehicle_id: vehicleIds
            },
            attributes: ['vehicle_id', 'vehicle_number', 'vehicle_type', 'creditlist_id']
        });
    },

    // Create a new vehicle for a credit party
    create: (vehicle) => {
        return CreditListVehicle.create(vehicle);
    },

    // Bulk create multiple vehicles (useful for your form submission)
    bulkCreate: (vehicles) => {
        return CreditListVehicle.bulkCreate(vehicles);
    },

    // Update vehicle details by vehicle_id
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

    // Disable a vehicle by setting effective_end_date to current date (soft delete)
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

    // Enable a vehicle (reset effective_end_date to far future date)
    enableVehicle: (vehicleId) => {
        const updateDate = "2400-01-01"; // Use a far future date for enabling
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
    }
};