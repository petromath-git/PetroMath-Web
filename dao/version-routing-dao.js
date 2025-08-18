const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    // Get current version for a location (defaults to 'stable' if no record)
    getCurrentVersion: async (location_code) => {
        try {
            const result = await db.sequelize.query(`
                SELECT app_version 
                FROM m_version_routing 
                WHERE location_code = :location_code 
                AND effective_start_date <= NOW() 
                AND (effective_end_date IS NULL OR effective_end_date > NOW())
                ORDER BY effective_start_date DESC 
                LIMIT 1
            `, {
                replacements: { location_code },
                type: Sequelize.QueryTypes.SELECT
            });

            // Default to 'stable' if no active record found
            return result.length > 0 ? result[0].app_version : 'stable';
        } catch (error) {
            console.error('Error getting version for location:', location_code, error);
            // Fallback to stable on any error
            return 'stable';
        }
    }
};