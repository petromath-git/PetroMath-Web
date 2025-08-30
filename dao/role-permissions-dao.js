// dao/role-permissions-dao.js
const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    // Get roles that a user can reset passwords for
    getRolesUserCanReset: async (userRole, locationCode) => {
        const query = `
            SELECT r2.role_name, rp.location_specific, rp.location_code
            FROM m_role_permissions rp
            JOIN m_roles r1 ON rp.role_id = r1.role_id
            JOIN m_roles r2 ON rp.can_reset_role_id = r2.role_id
            WHERE r1.role_name = :userRole 
              AND rp.permission_type = 'PASSWORD_RESET'
              AND r1.is_active = 1 
              AND r2.is_active = 1
              AND (rp.location_code IS NULL OR rp.location_code = :locationCode)
              AND CURDATE() BETWEEN rp.effective_start_date AND rp.effective_end_date
              AND CURDATE() BETWEEN r1.effective_start_date AND r1.effective_end_date
              AND CURDATE() BETWEEN r2.effective_start_date AND r2.effective_end_date
            ORDER BY rp.location_code DESC
        `;
        
        const results = await db.sequelize.query(query, {
            replacements: { userRole, locationCode },
            type: QueryTypes.SELECT
        });
        
        // Remove duplicates - location-specific overrides global
        const uniqueRoles = new Map();
        results.forEach(row => {
            if (!uniqueRoles.has(row.role_name) || row.location_code !== null) {
                uniqueRoles.set(row.role_name, {
                    role: row.role_name,
                    locationSpecific: row.location_specific,
                    isLocationOverride: row.location_code !== null
                });
            }
        });
        
        return Array.from(uniqueRoles.values());
    },

    // Check if user can reset specific target user's password
    canResetPassword: async (userRole, targetRole, userLocation, targetLocation) => {
        const query = `
            SELECT rp.location_specific, rp.location_code
            FROM m_role_permissions rp
            JOIN m_roles r1 ON rp.role_id = r1.role_id
            JOIN m_roles r2 ON rp.can_reset_role_id = r2.role_id
            WHERE r1.role_name = :userRole 
              AND r2.role_name = :targetRole
              AND rp.permission_type = 'PASSWORD_RESET'
              AND r1.is_active = 1 
              AND r2.is_active = 1
              AND (rp.location_code IS NULL OR rp.location_code = :userLocation)
              AND CURDATE() BETWEEN rp.effective_start_date AND rp.effective_end_date
              AND CURDATE() BETWEEN r1.effective_start_date AND r1.effective_end_date
              AND CURDATE() BETWEEN r2.effective_start_date AND r2.effective_end_date
            ORDER BY rp.location_code DESC
            LIMIT 1
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { userRole, targetRole, userLocation },
            type: QueryTypes.SELECT
        });
        
        if (result.length === 0) {
            return false;
        }
        
        // If location_specific is 1, check if same location
        if (result[0].location_specific === 1) {
            return userLocation === targetLocation;
        }
        
        return true;
    },

    // Get all active roles (for admin interface)
    getAllRoles: async () => {
        const query = `
            SELECT role_id, role_name, role_display_name, role_level, 
                   is_customer_role, role_description
            FROM m_roles 
            WHERE is_active = 1
              AND CURDATE() BETWEEN effective_start_date AND effective_end_date
            ORDER BY role_level DESC, role_name
        `;
        
        const results = await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
        
        return results;
    },

    // Get permissions for a specific location (for debugging/admin)
    getLocationPermissions: async (locationCode) => {
        const query = `
            SELECT 
                r1.role_name as user_role,
                r2.role_name as can_reset_role,
                rp.location_specific,
                rp.location_code,
                CASE 
                    WHEN rp.location_code IS NULL THEN 'Global Rule'
                    ELSE CONCAT('Location Override: ', rp.location_code)
                END as permission_scope
            FROM m_role_permissions rp
            JOIN m_roles r1 ON rp.role_id = r1.role_id
            JOIN m_roles r2 ON rp.can_reset_role_id = r2.role_id
            WHERE (rp.location_code IS NULL OR rp.location_code = :locationCode)
              AND rp.permission_type = 'PASSWORD_RESET'
              AND CURDATE() BETWEEN rp.effective_start_date AND rp.effective_end_date
            ORDER BY r1.role_name, rp.location_code DESC, r2.role_name
        `;
        
        const results = await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
        
        return results;
    }
};