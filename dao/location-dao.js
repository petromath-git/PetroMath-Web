const db = require("../db/db-connection");
const Location = db.location;
const { Op } = require("sequelize");
const lookupDao = require('./lookup-dao');
const dateFormat = require("dateformat");

module.exports = {
    // Method to fetch all locations from the database
   findAllLocations: async function () {
    try {
        // Query the location table to get all locations
        // Sort by: active first (effective_end_date DESC to put 9999-12-31 first), 
        // then by start_date ASC
            const locations = await Location.findAll({
            attributes: ['location_id', 'location_code', 'location_name', 'address', 
                       'company_name', 'gst_number', 'phone', 'start_date', 
                       'effective_end_date', 'created_by', 'updated_by', 
                       'creation_date', 'updation_date'],
            order: [
                ['effective_end_date', 'DESC'],  // Active locations (9999-12-31) first
                ['start_date', 'ASC']             // Then by start date ascending
            ]
          });

            return locations; // Return the fetched locations
        } catch (error) {
            console.error("Error fetching locations:", error);
            throw error;  // Rethrow the error to be handled in the controller
        }
    },

    // Find active locations only (start_date <= today AND effective_end_date > today)
    findActiveLocations: async function () {
        try {
            const currentDate = new Date();
            const locations = await Location.findAll({
                where: {
                    start_date: { [Op.lte]: currentDate },
                    effective_end_date: { [Op.gt]: currentDate }
                },
                order: [['location_name', 'ASC']]
            });
            return locations;
        } catch (error) {
            console.error("Error fetching active locations:", error);
            throw error;
        }
    },

    // Find by location code
    findByLocationCode: async function (locationCode) {
        try {
            const location = await Location.findOne({
                where: { location_code: locationCode }
            });
            return location;
        } catch (error) {
            console.error("Error fetching location by code:", error);
            throw error;
        }
    },

    // Find by location ID
    findById: async function (locationId) {
        try {
            const location = await Location.findOne({
                where: { location_id: locationId }
            });
            return location;
        } catch (error) {
            console.error("Error fetching location by ID:", error);
            throw error;
        }
    },

    // Create new location
    create: async function (locationData) {
        try {
            const newLocation = await Location.create({
                location_code: locationData.location_code,
                location_name: locationData.location_name,
                address: locationData.address,
                company_name: locationData.company_name,
                gst_number: locationData.gst_number || null,
                phone: locationData.phone,
                start_date: locationData.start_date,
                effective_end_date: locationData.effective_end_date || '9999-12-31',
                created_by: locationData.created_by,
                creation_date: new Date()
            });
            return newLocation;
        } catch (error) {
            console.error("Error creating location:", error);
            throw error;
        }
    },

    // Update existing location (location_code cannot be changed)
    update: async function (locationId, locationData) {
        try {
            const result = await Location.update({
                location_name: locationData.location_name,
                address: locationData.address,
                company_name: locationData.company_name,
                gst_number: locationData.gst_number || null,
                phone: locationData.phone,
                start_date: locationData.start_date,
                effective_end_date: locationData.effective_end_date,
                updated_by: locationData.updated_by,
                updation_date: new Date()
            }, {
                where: { location_id: locationId }
            });
            return result;
        } catch (error) {
            console.error("Error updating location:", error);
            throw error;
        }
    },

    // Deactivate location (set effective_end_date to today)
    deactivate: async function (locationId, updatedBy) {
        try {
            const today = dateFormat(new Date(), "yyyy-mm-dd");
            const result = await Location.update({
                effective_end_date: today,
                updated_by: updatedBy,
                updation_date: new Date()
            }, {
                where: { location_id: locationId }
            });
            return result;
        } catch (error) {
            console.error("Error deactivating location:", error);
            throw error;
        }
    },

    // Reactivate location (set effective_end_date to 9999-12-31)
    reactivate: async function (locationId, updatedBy) {
        try {
            const result = await Location.update({
                effective_end_date: '9999-12-31',
                updated_by: updatedBy,
                updation_date: new Date()
            }, {
                where: { location_id: locationId }
            });
            return result;
        } catch (error) {
            console.error("Error reactivating location:", error);
            throw error;
        }
    },

    // Check for duplicate location code (excluding current location during edit)
    checkDuplicateCode: async function (locationCode, excludeId = null) {
        try {
            const whereClause = { location_code: locationCode };
            if (excludeId) {
                whereClause.location_id = { [Op.ne]: excludeId };
            }
            
            const existing = await Location.findOne({
                where: whereClause
            });
            
            return !!existing;
        } catch (error) {
            console.error("Error checking duplicate code:", error);
            throw error;
        }
    },

    // Validate location code format (3-5 chars, alphanumeric uppercase, no spaces)
        validateLocationCode: function (locationCode) {
            const regex = /^[A-Z0-9]{3,5}$/;
            return regex.test(locationCode);
        },

    // Get oil companies from lookup table
    getOilCompanies: async function () {        
        return await lookupDao.getOilCompanies();
    },

    // Check if a location is active
isLocationActive: async function (locationCode) {
    try {
        const currentDate = new Date();
        const location = await Location.findOne({
            where: {
                location_code: locationCode,
                start_date: { [Op.lte]: currentDate },
                effective_end_date: { [Op.gt]: currentDate }
            }
        });
        return !!location; // Returns true if location is active, false otherwise
    } catch (error) {
        console.error("Error checking if location is active:", error);
        throw error;
    }
},


};