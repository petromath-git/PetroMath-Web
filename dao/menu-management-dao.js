// dao/menu-management-dao.js
const db = require("../db/db-connection");
const { Op, QueryTypes } = require("sequelize");

const menuManagementDao = {
    
    // MENU ITEMS CRUD
    getAllMenuItems: async () => {
        return await db.menu_items.findAll({
            where: {
                effective_start_date: { [Op.lte]: new Date() },
                [Op.or]: [
                    { effective_end_date: null },
                    { effective_end_date: { [Op.gte]: new Date() } }
                ]
            },
            order: [['sequence', 'ASC'], ['menu_name', 'ASC']]
        });
    },

    createMenuItem: async (menuData) => {
        return await db.menu_items.create(menuData);
    },

    updateMenuItem: async (menuId, menuData) => {
        return await db.menu_items.update(menuData, {
            where: { menu_id: menuId }
        });
    },

    deleteMenuItem: async (menuId, updatedBy) => {
        return await db.menu_items.update({
            effective_end_date: new Date(),
            updated_by: updatedBy,
            updation_date: new Date()
        }, {
            where: { menu_id: menuId }
        });
    },

    // MENU GROUPS CRUD
    getAllMenuGroups: async () => {
        return await db.menu_groups.findAll({
            where: {
                effective_start_date: { [Op.lte]: new Date() },
                [Op.or]: [
                    { effective_end_date: null },
                    { effective_end_date: { [Op.gte]: new Date() } }
                ]
            },
            order: [['group_sequence', 'ASC'], ['group_name', 'ASC']]
        });
    },

    createMenuGroup: async (groupData) => {
        return await db.menu_groups.create(groupData);
    },

    updateMenuGroup: async (groupId, groupData) => {
        return await db.menu_groups.update(groupData, {
            where: { group_id: groupId }
        });
    },

    deleteMenuGroup: async (groupId, updatedBy) => {
        return await db.menu_groups.update({
            effective_end_date: new Date(),
            updated_by: updatedBy,
            updation_date: new Date()
        }, {
            where: { group_id: groupId }
        });
    },

    getMenuGroups: async () => {
        // Updated to use the actual table instead of derived query
        return await db.menu_groups.findAll({
            where: {
                effective_start_date: { [Op.lte]: new Date() },
                [Op.or]: [
                    { effective_end_date: null },
                    { effective_end_date: { [Op.gte]: new Date() } }
                ]
            },
            order: [['group_sequence', 'ASC'], ['group_name', 'ASC']]
        });
    },

    // MENU ACCESS
    getAllRoles: async () => {
        const query = `
            SELECT role_id, role_name, role_display_name, role_level 
            FROM m_roles 
            WHERE is_active = 1
            ORDER BY role_level DESC
        `;
        
        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
    },

    getMenuAccessMatrix: async (locationCode) => {
        const query = `
            SELECT DISTINCT
                role,
                menu_code,
                menu_name,
                allowed,
                source
            FROM m_menu_access_v
            WHERE location_code = ?
            ORDER BY role, menu_name
        `;
        
        return await db.sequelize.query(query, {
            replacements: [locationCode],
            type: QueryTypes.SELECT
        });
    },

    updateGlobalMenuAccess: async (role, menuCode, allowed, createdBy) => {
        return await db.menu_access_global.upsert({
            role,
            menu_code: menuCode,
            allowed,
            effective_start_date: new Date(),
            created_by: createdBy,
            updated_by: createdBy
        });
    },

    updateOverrideMenuAccess: async (role, locationCode, menuCode, allowed, createdBy) => {
        return await db.menu_access_override.upsert({
            role,
            location_code: locationCode,
            menu_code: menuCode,
            allowed,
            effective_start_date: new Date(),
            created_by: createdBy,
            updated_by: createdBy
        });
    },
    createDefaultPermission: async (role, menuCode, createdBy) => {
    return await db.menu_access_global.create({
        role,
        menu_code: menuCode,
        allowed: 1,
        effective_start_date: new Date(),
        created_by: createdBy,
        updated_by: createdBy,
        creation_date: new Date(),
        updation_date: new Date()
    });
    },

    // CACHE MANAGEMENT
    refreshMenuCache: async () => {
        const query = `CALL refreshmenucache()`;
        
        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
    },

    getLastCacheRefresh: async () => {
        const query = `
            SELECT 
                refresh_time, 
                records_refreshed, 
                duration_ms
            FROM menu_cache_refresh_log 
            ORDER BY refresh_time DESC 
            LIMIT 1
        `;
        
        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
    },

    getAccessReportMatrix: async (locationCode) => {
    const query = `
        SELECT 
            mi.menu_code,
            mi.menu_name,
            mi.sequence,
            mg.group_code,
            mg.group_name,
            mg.group_sequence,
            GROUP_CONCAT(
                CONCAT(m.role, ':', m.allowed) 
                ORDER BY r.role_level DESC
                SEPARATOR '|'
            ) as role_permissions
        FROM m_menu_items mi
        LEFT JOIN m_menu_groups mg ON mi.group_code = mg.group_code
        LEFT JOIN m_menu_access_v m ON mi.menu_code = m.menu_code 
            AND m.location_code = ?
        LEFT JOIN m_roles r ON m.role = r.role_name
        WHERE mi.effective_start_date <= CURDATE()
        AND (mi.effective_end_date IS NULL OR mi.effective_end_date >= CURDATE())
        GROUP BY mi.menu_code, mi.menu_name, mi.sequence, 
                 mg.group_code, mg.group_name, mg.group_sequence
        ORDER BY mg.group_sequence, mi.sequence, mi.menu_name
    `;
    
    return await db.sequelize.query(query, {
        replacements: [locationCode],
        type: QueryTypes.SELECT
    });
},


checkSequenceInGroup: async (groupCode, sequence, excludeMenuId = null) => {
    const whereClause = {
        group_code: groupCode,
        sequence: sequence,
        effective_start_date: { [Op.lte]: new Date() },
        [Op.or]: [
            { effective_end_date: null },
            { effective_end_date: { [Op.gte]: new Date() } }
        ]
    };
    
    // Exclude current menu when editing
    if (excludeMenuId) {
        whereClause.menu_id = { [Op.ne]: excludeMenuId };
    }
    
    return await db.menu_items.findOne({
        where: whereClause,
        attributes: ['menu_id', 'menu_code', 'menu_name', 'sequence']
    });
},


};

module.exports = menuManagementDao;