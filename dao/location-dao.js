const db = require("../db/db-connection");
const Location = db.location;
const { Op } = require("sequelize");
const lookupDao = require('./lookup-dao');
const dateFormat = require("dateformat");

// Last staff activity per location is a ~0.3s scan of t_user_activity_log,
// so the Select Location page shares one result for a few minutes.
const STAFF_ACTIVITY_TTL_MS = 5 * 60 * 1000;
let staffActivityCache = { at: 0, rows: null };
const SNAPSHOT_DAYS = 14;
let snapshotCache = { at: 0, rows: null };
// MySQL runs on UTC; shift dates are Indian business dates
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";

module.exports = {
    // Last page opened at each active location by its own staff (SuperUser and
    // PowerUser visits excluded, so support/admin access doesn't look like usage).
    getLastStaffActivity: async function () {
        if (staffActivityCache.rows && Date.now() - staffActivityCache.at < STAFF_ACTIVITY_TTL_MS) {
            return staffActivityCache.rows;
        }
        const rows = await db.sequelize.query(`
            SELECT t.location_code,
                   TIMESTAMPDIFF(MINUTE, t.last_used, NOW()) AS minutes_ago,
                   UPPER(DATE_FORMAT(t.last_used, '%d-%b-%Y')) AS last_used_date
            FROM (
                SELECT ml.location_code,
                       (SELECT a.access_timestamp
                        FROM t_user_activity_log a
                        JOIN m_persons p ON p.Person_id = a.person_id
                        WHERE a.location_code = ml.location_code
                          AND p.Role NOT IN ('SuperUser', 'PowerUser')
                        ORDER BY a.access_timestamp DESC
                        LIMIT 1) AS last_used
                FROM m_location ml
                WHERE ml.start_date <= NOW() AND ml.effective_end_date > CURDATE()
            ) t
        `, { type: db.sequelize.QueryTypes.SELECT });
        staffActivityCache = { at: Date.now(), rows };
        return rows;
    },

    // Per-location shift snapshot for the Select Location tiles (SuperUser/PowerUser):
    // last shift / last closed shift, last day close and a per-day count for the last
    // SNAPSHOT_DAYS days. Keyed by location_code; shared for a few minutes like staff activity.
    getLocationSnapshot: async function () {
        if (snapshotCache.rows && Date.now() - snapshotCache.at < STAFF_ACTIVITY_TTL_MS) {
            return snapshotCache.rows;
        }
        const select = (sql) => db.sequelize.query(sql, { type: db.sequelize.QueryTypes.SELECT });
        const [lastShifts, daily, dayCloses] = await Promise.all([
            select(`
                SELECT location_code,
                       UPPER(DATE_FORMAT(MAX(closing_date), '%d-%b-%Y')) AS last_shift_date,
                       DATEDIFF(${IST_TODAY}, MAX(CASE WHEN closing_status = 'CLOSED' THEN closing_date END)) AS days_since_closed,
                       UPPER(DATE_FORMAT(MAX(CASE WHEN closing_status = 'CLOSED' THEN closing_date END), '%d-%b-%Y')) AS last_closed_date,
                       SUM(CASE WHEN closing_status = 'DRAFT' THEN 1 ELSE 0 END) AS open_drafts
                FROM t_closing
                GROUP BY location_code`),
            select(`
                SELECT location_code,
                       DATEDIFF(${IST_TODAY}, DATE(closing_date)) AS days_ago,
                       SUM(CASE WHEN closing_status = 'CLOSED' THEN 1 ELSE 0 END) AS closed,
                       SUM(CASE WHEN closing_status = 'DRAFT' THEN 1 ELSE 0 END) AS drafts
                FROM t_closing
                WHERE closing_date >= ${IST_TODAY} - INTERVAL ${SNAPSHOT_DAYS - 1} DAY
                GROUP BY location_code, DATE(closing_date)`),
            select(`
                SELECT location_code,
                       UPPER(DATE_FORMAT(MAX(cashflow_date), '%d-%b-%Y')) AS last_day_close_date,
                       DATEDIFF(${IST_TODAY}, MAX(cashflow_date)) AS days_since_day_close
                FROM t_cashflow_closing
                WHERE closing_status = 'CLOSED'
                GROUP BY location_code`)
        ]);

        const byLocation = {};
        const entry = (code) => byLocation[code] || (byLocation[code] = {
            location_code: code, days: Array.from({ length: SNAPSHOT_DAYS }, () => ({ closed: 0, drafts: 0 }))
        });
        lastShifts.forEach(r => Object.assign(entry(r.location_code), {
            last_shift_date: r.last_shift_date,
            last_closed_date: r.last_closed_date,
            days_since_closed: r.days_since_closed,
            open_drafts: Number(r.open_drafts) || 0
        }));
        // days[] runs oldest → today so the strip reads left to right
        daily.forEach(r => {
            const idx = SNAPSHOT_DAYS - 1 - r.days_ago;
            if (idx >= 0 && idx < SNAPSHOT_DAYS) {
                entry(r.location_code).days[idx] = { closed: Number(r.closed) || 0, drafts: Number(r.drafts) || 0 };
            }
        });
        dayCloses.forEach(r => Object.assign(entry(r.location_code), {
            last_day_close_date: r.last_day_close_date,
            days_since_day_close: r.days_since_day_close
        }));

        const rows = Object.values(byLocation);
        snapshotCache = { at: Date.now(), rows };
        return rows;
    },

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
    // m_location.start_date when no shift exists yet; null if neither. A
    // GOLIVE_DATE location setting earlier than that takes precedence.
    // Uses the get_location_golive_date() SQL function so the screens and the
    // guard triggers always agree.
    getGoLiveDate: async function (locationCode) {
        const rows = await db.sequelize.query(`
            SELECT DATE_FORMAT(get_location_golive_date(:locationCode), '%Y-%m-%d') AS golive
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