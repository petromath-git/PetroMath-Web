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
    },

    // Every active location with its current routing (beta admin screen)
    getLocationRouting: async () => {
        return db.sequelize.query(`
            SELECT l.location_code, l.location_name,
                   r.routing_id, r.app_version, r.effective_start_date,
                   r.effective_end_date, r.updated_by
            FROM m_location l
            LEFT JOIN m_version_routing r
              ON r.routing_id = (
                  SELECT r2.routing_id FROM m_version_routing r2
                  WHERE r2.location_code = l.location_code
                    AND r2.effective_start_date <= NOW()
                    AND (r2.effective_end_date IS NULL OR r2.effective_end_date > NOW())
                  ORDER BY r2.effective_start_date DESC
                  LIMIT 1)
            WHERE l.start_date <= NOW() AND l.effective_end_date > NOW()
            ORDER BY (r.app_version = 'canary') DESC, l.location_code
        `, { type: Sequelize.QueryTypes.SELECT });
    },

    // Grant beta access from now on (no-op if already active)
    enableCanary: async (location_code, updated_by) => {
        const current = await module.exports.getCurrentVersion(location_code);
        if (current === 'canary') return false;
        await db.sequelize.query(`
            INSERT INTO m_version_routing
                (location_code, app_version, effective_start_date, effective_end_date, updated_by)
            VALUES (:location_code, 'canary', NOW(), NULL, :updated_by)
        `, { replacements: { location_code, updated_by } });
        return true;
    },

    // Revoke beta access: end-date every active canary row for the location
    disableCanary: async (location_code, updated_by) => {
        const [, meta] = await db.sequelize.query(`
            UPDATE m_version_routing
            SET effective_end_date = NOW(), updated_by = :updated_by
            WHERE location_code = :location_code
              AND app_version = 'canary'
              AND effective_start_date <= NOW()
              AND (effective_end_date IS NULL OR effective_end_date > NOW())
        `, { replacements: { location_code, updated_by } });
        return meta && meta.affectedRows > 0;
    },

    getRecentAudit: async (limit = 30) => {
        try {
            return await db.sequelize.query(`
                SELECT location_code, action_type, old_app_version, new_app_version,
                       new_effective_end_date, new_updated_by, change_date
                FROM m_version_routing_audit
                ORDER BY audit_id DESC
                LIMIT :limit
            `, { replacements: { limit }, type: Sequelize.QueryTypes.SELECT });
        } catch (e) {
            return []; // audit table may not exist
        }
    }
};