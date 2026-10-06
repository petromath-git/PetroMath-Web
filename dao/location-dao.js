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
            attributes: ['location_id', 'location_code', 'location_name', 'address', 'place',
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
    // locationCodes: optional array to restrict results to (e.g. a PowerUser's assigned locations)
    findActiveLocations: async function (locationCodes = null) {
        try {
            const currentDate = new Date();
            const where = {
                start_date: { [Op.lte]: currentDate },
                effective_end_date: { [Op.gt]: currentDate }
            };
            if (Array.isArray(locationCodes)) {
                where.location_code = { [Op.in]: locationCodes };
            }
            const locations = await Location.findAll({
                where,
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
                place: locationData.place || null,
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
                place: locationData.place,
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

    // Go-live date (YYYY-MM-DD) = date of the first shift; falls back to
    // m_location.start_date when no shift exists yet; null if neither.
    // Mirrors the get_location_golive_date() SQL function used by the guard triggers.
    getGoLiveDate: async function (locationCode) {
        const rows = await db.sequelize.query(`
            SELECT COALESCE(
                (SELECT DATE_FORMAT(DATE(MIN(closing_date)), '%Y-%m-%d')
                 FROM t_closing WHERE location_code = :locationCode),
                (SELECT DATE_FORMAT(MIN(DATE(start_date)), '%Y-%m-%d')
                 FROM m_location WHERE location_code = :locationCode AND start_date > '1971-01-01')
            ) AS golive
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
        return rows[0] ? rows[0].golive : null;
    },

    // Date (YYYY-MM-DD) of the location's first shift, or null if none yet.
    // Opening balances belong on the day before this date.
    getFirstShiftDate: async function (locationCode) {
        const rows = await db.sequelize.query(`
            SELECT DATE_FORMAT(DATE(MIN(closing_date)), '%Y-%m-%d') AS first_shift
            FROM t_closing WHERE location_code = :locationCode
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
        return rows[0] ? rows[0].first_shift : null;
    },

    
// Check if a location is active and get service tier
isLocationActive: async function (locationCode) {
    try {
        const currentDate = new Date();
        const location = await Location.findOne({
            where: {
                location_code: locationCode,
                start_date: { [Op.lte]: currentDate },
                effective_end_date: { [Op.gt]: currentDate }
            },
            attributes: ['location_code', 'service_tier']
        });
        
        if (location) {
            return {
                isActive: true,
                service_tier: location.service_tier || 'standard'
            };
        }
        return {
            isActive: false,
            service_tier: null
        };
    } catch (error) {
        console.error("Error checking if location is active:", error);
        throw error;
    }
},


};