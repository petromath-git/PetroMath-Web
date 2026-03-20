const db = require("../db/db-connection");
const Lookup = db.lookup;
const { Op } = require("sequelize");

module.exports = {
    /**
     * Get customer types available for a location
     * Returns global types + location-specific types
     */
    getCustomerTypes: async (locationCode) => {
        try {
            const currentDate = new Date();
            
            const types = await Lookup.findAll({
                attributes: ['description', 'tag', 'attribute1', 'attribute2', 'attribute3'],
                where: {
                    lookup_type: 'CREDIT_CUSTOMER_TYPE',
                    start_date_active: {
                        [Op.lte]: currentDate
                    },
                    end_date_active: {
                        [Op.gte]: currentDate
                    },
                    [Op.or]: [
                        { location_code: null },           // Global types
                        { location_code: locationCode }    // Location-specific types
                    ]
                },
                order: [
                    [db.sequelize.cast(db.sequelize.col('attribute1'), 'UNSIGNED'), 'ASC'],
                    ['description', 'ASC']
                ]
            });
            
            // Remove duplicates (prefer location-specific over global)
            const uniqueTypes = [];
            const seenDescriptions = new Set();
            
            types.forEach(type => {
                if (!seenDescriptions.has(type.description)) {
                    uniqueTypes.push({
                        description: type.description,
                        tag: type.tag,
                        display_order: type.attribute1,
                        is_default: type.attribute2 === 'Y',
                        notes: type.attribute3
                    });
                    seenDescriptions.add(type.description);
                }
            });
            
            return uniqueTypes;
        } catch (error) {
            console.error('Error fetching customer types:', error);
            throw error;
        }
    },
    
    /**
     * Get the default customer type for a location
     */
    getDefaultCustomerType: async (locationCode) => {
        try {
            const types = await module.exports.getCustomerTypes(locationCode);
            const defaultType = types.find(t => t.is_default);
            return defaultType ? defaultType.description : (types[0]?.description || 'Credit');
        } catch (error) {
            console.error('Error fetching default customer type:', error);
            return 'Credit'; // Fallback
        }
    },

    /**
     * Get oil companies for location master
     * Returns companies like IOCL, BPCL, HPCL, NAYARA
     */
    getOilCompanies: async () => {
        try {
            const currentDate = new Date();
            
            const companies = await Lookup.findAll({
                attributes: ['description'],
                where: {
                    lookup_type: 'OIL_COMPANY',
                    start_date_active: {
                        [Op.lte]: currentDate
                    },
                    end_date_active: {
                        [Op.gte]: currentDate
                    }
                },
                order: [['description', 'ASC']]
            });
            
            return companies.map(c => c.description);
        } catch (error) {
            console.error('Error fetching oil companies:', error);
            // Return default list if lookup fails
            return ['IOCL', 'BPCL', 'HPCL', 'NAYARA'];
        }
    },

    /**
     * Get lookup values by type (generic method)
     * @param {string} lookupType - The lookup type to fetch
     * @param {string} locationCode - Optional location code for location-specific lookups
     */
    // ── Admin methods ─────────────────────────────────────────────────────────

    /**
     * Get all distinct lookup types visible to the user.
     * SuperUser: every type. Others: types with global or their location's values.
     */
    getAllLookupTypes: async (userRole, locationCode) => {
        const isSuperUser = userRole === 'SuperUser';
        const activeExpr = `CASE WHEN (start_date_active IS NULL OR CURDATE() >= DATE(start_date_active))
                                  AND (end_date_active IS NULL OR CURDATE() <= DATE(end_date_active))
                             THEN 1 ELSE 0 END`;
        const query = isSuperUser
            ? `SELECT lookup_type,
                      COUNT(*) AS total_count,
                      SUM(${activeExpr}) AS active_count
               FROM m_lookup
               GROUP BY lookup_type
               ORDER BY lookup_type`
            : `SELECT lookup_type,
                      COUNT(*) AS total_count,
                      SUM(${activeExpr}) AS active_count
               FROM m_lookup
               WHERE location_code IS NULL OR location_code = :locationCode
               GROUP BY lookup_type
               ORDER BY lookup_type`;
        return db.sequelize.query(query, {
            replacements: isSuperUser ? {} : { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    /**
     * Get all values for a type for the admin view (includes inactive rows).
     * SuperUser: all locations. Others: global + their location only.
     */
    getValuesForAdmin: async (lookupType, userRole, locationCode) => {
        const whereClause = { lookup_type: lookupType };
        if (userRole !== 'SuperUser') {
            whereClause[Op.or] = [{ location_code: null }, { location_code: locationCode }];
        }
        return Lookup.findAll({
            attributes: ['lookup_id', 'description', 'tag', 'attribute1', 'attribute2', 'attribute3', 'location_code', 'start_date_active', 'end_date_active'],
            where: whereClause,
            order: [
                [db.Sequelize.literal('CAST(IFNULL(attribute1, 999) AS UNSIGNED)'), 'ASC'],
                ['description', 'ASC']
            ]
        });
    },

    /** Insert a new lookup value. */
    createLookupValue: async (data) => {
        return Lookup.create({
            lookup_type: data.lookup_type,
            description: data.description,
            tag: data.tag || null,
            attribute1: data.attribute1 || null,
            attribute2: data.attribute2 || null,
            attribute3: data.attribute3 || null,
            location_code: data.location_code || null,
            start_date_active: data.start_date_active || new Date(),
            end_date_active: data.end_date_active || new Date('2099-12-31'),
            created_by: data.created_by,
            creation_date: new Date()
        });
    },

    /** Deactivate a lookup value by setting end_date_active to today. */
    deactivateLookupValue: async (lookupId, updatedBy) => {
        return Lookup.update(
            { end_date_active: new Date(), updated_by: updatedBy, updation_date: new Date() },
            { where: { lookup_id: lookupId } }
        );
    },

    /** Reactivate a lookup value by resetting end_date_active to far future. */
    reactivateLookupValue: async (lookupId, updatedBy) => {
        return Lookup.update(
            { end_date_active: new Date('2099-12-31'), updated_by: updatedBy, updation_date: new Date() },
            { where: { lookup_id: lookupId } }
        );
    },

    // ── Consumer methods ──────────────────────────────────────────────────────

    getLookupByType: async (lookupType, locationCode = null) => {
        try {
            const currentDate = new Date();
            
            const whereClause = {
                lookup_type: lookupType,
                start_date_active: {
                    [Op.lte]: currentDate
                },
                end_date_active: {
                    [Op.gte]: currentDate
                }
            };

            // Add location filter if locationCode is provided
            if (locationCode) {
                whereClause[Op.or] = [
                    { location_code: null },           // Global lookups
                    { location_code: locationCode }    // Location-specific lookups
                ];
            }
            
            const values = await Lookup.findAll({
                attributes: ['lookup_id', 'description', 'tag', 'attribute1', 'attribute2', 'attribute3', 'location_code'],
                where: whereClause,
                order: [
                    [db.Sequelize.literal('CAST(IFNULL(attribute1, 999) AS UNSIGNED)'), 'ASC'],
                    ['description', 'ASC']
                ]
            });

            // If locationCode provided, remove duplicates (prefer location-specific over global)
            if (locationCode) {
                const uniqueValues = [];
                const seenDescriptions = new Set();
                
                // Sort to prioritize location-specific entries (location_code !== null comes first)
                values.sort((a, b) => {
                    if (a.location_code && !b.location_code) return -1;
                    if (!a.location_code && b.location_code) return 1;
                    return 0;
                });
                
                values.forEach(val => {
                    if (!seenDescriptions.has(val.description)) {
                        uniqueValues.push(val);
                        seenDescriptions.add(val.description);
                    }
                });
                
                return uniqueValues;
            }
            
            return values;
        } catch (error) {
            console.error(`Error fetching lookup type ${lookupType}:`, error);
            throw error;
        }
    }
};