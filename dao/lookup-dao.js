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
     */
    getLookupByType: async (lookupType) => {
        try {
            const currentDate = new Date();
            
            const values = await Lookup.findAll({
                attributes: ['lookup_id', 'description', 'tag', 'attribute1', 'attribute2', 'attribute3'],
                where: {
                    lookup_type: lookupType,
                    start_date_active: {
                        [Op.lte]: currentDate
                    },
                    end_date_active: {
                        [Op.gte]: currentDate
                    }
                },
                order: [['description', 'ASC']]
            });
            
            return values;
        } catch (error) {
            console.error(`Error fetching lookup type ${lookupType}:`, error);
            throw error;
        }
    }
};