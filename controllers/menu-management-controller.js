// controllers/menu-management-controller.js
const menuManagementDao = require('../dao/menu-management-dao');
const security = require('../utils/app-security');

// Menu items behind these URL prefixes are platform-level (billing, dev tooling,
// usage stats, assigning other users to locations) — a location-scoped role like
// PartnerAdmin must not be able to grant/toggle visibility into them, even though
// the underlying routes are separately permission-gated regardless of menu visibility.
const PLATFORM_ONLY_URL_PREFIXES = [
    '/platform-billing', '/usage-dashboard', '/dev-tracker',
    '/system-health', '/person-locations', '/dev-db-refresh'
];

function isPlatformOnlyMenuItem(item) {
    const url = item.url_path || '';
    return PLATFORM_ONLY_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

const menuManagementController = {

    // Render the main menu management page
    // The 4 global tabs (Menu Items, Menu Groups, Global Access, Cache) affect
    // every location and role in the system — SuperUser only. Location Overrides
    // is scoped per-location and also available to PartnerAdmin.
    renderPage: async (req, res, next) => {
        try {
            res.render('menu-management', {
                title: 'Menu Management',
                user: req.user,
                location: req.user.location_code,
                showGlobalMenuTabs: req.user.Role === 'SuperUser'
            });
        } catch (error) {
            console.error('Error rendering menu management page:', error);
            res.status(500).send('Error loading menu management page');
        }
    },

    // GET: All menu items
    getMenuItems: async (req, res, next) => {
        try {
            const menuItems = await menuManagementDao.getAllMenuItems();

            res.json({
                success: true,
                data: menuItems
            });

        } catch (error) {
            console.error('Error fetching menu items:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch menu items: ' + error.message
            });
        }
    },

    // CREATE: New menu item
    createMenuItem: async (req, res, next) => {
        try {

             // Check for duplicate sequence in the same group
            const existingItem = await menuManagementDao.checkSequenceInGroup(
                req.body.group_code,
                req.body.sequence
            );
            
            if (existingItem) {
                return res.status(400).json({
                    success: false,
                    error: `Sequence ${req.body.sequence} is already used by "${existingItem.menu_name}" in this group. Please use a different sequence number.`
                });
            }

            const menuData = {
                ...req.body,
                effective_start_date: new Date(),
                created_by: req.user.User_Name,
                updated_by: req.user.User_Name
            };
            
            await menuManagementDao.createMenuItem(menuData);

            // Automatically create SuperUser permission for the new menu item
            await menuManagementDao.createDefaultPermission(
                'SuperUser',
                req.body.menu_code,
                req.user.User_Name
            );

            res.json({
                success: true,
                message: 'Menu item created successfully with SuperUser access'
            });

        } catch (error) {
            console.error('Error creating menu item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create menu item: ' + error.message
            });
        }
    },

    // UPDATE: Existing menu item
    updateMenuItem: async (req, res, next) => {
        try {
            const { id } = req.params;
            const menuData = {
                ...req.body,
                updated_by: req.user.User_Name,
                updation_date: new Date()
            };
            
            await menuManagementDao.updateMenuItem(id, menuData);

            res.json({
                success: true,
                message: 'Menu item updated successfully'
            });

        } catch (error) {
            console.error('Error updating menu item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update menu item: ' + error.message
            });
        }
    },

    // DELETE: Menu item (soft delete)
    deleteMenuItem: async (req, res, next) => {
        try {
            const { id } = req.params;
            
            await menuManagementDao.deleteMenuItem(id, req.user.User_Name);

            res.json({
                success: true,
                message: 'Menu item deleted successfully'
            });

        } catch (error) {
            console.error('Error deleting menu item:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete menu item: ' + error.message
            });
        }
    },

    // GET: Menu groups
    getMenuGroups: async (req, res, next) => {
        try {
            const groups = await menuManagementDao.getAllMenuGroups();

            res.json({
                success: true,
                data: groups
            });

        } catch (error) {
            console.error('Error fetching menu groups:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch menu groups: ' + error.message
            });
        }
    },

    // CREATE: New menu group
    createMenuGroup: async (req, res, next) => {
        try {
            const groupData = {
                ...req.body,
                effective_start_date: new Date(),
                created_by: req.user.User_Name,
                updated_by: req.user.User_Name
            };
            
            await menuManagementDao.createMenuGroup(groupData);

            res.json({
                success: true,
                message: 'Menu group created successfully'
            });

        } catch (error) {
            console.error('Error creating menu group:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create menu group: ' + error.message
            });
        }
    },

    // UPDATE: Existing menu group
    updateMenuGroup: async (req, res, next) => {
        try {
            const { id } = req.params;
            const groupData = {
                ...req.body,
                updated_by: req.user.User_Name,
                updation_date: new Date()
            };
            
            await menuManagementDao.updateMenuGroup(id, groupData);

            res.json({
                success: true,
                message: 'Menu group updated successfully'
            });

        } catch (error) {
            console.error('Error updating menu group:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update menu group: ' + error.message
            });
        }
    },

    // DELETE: Menu group (soft delete)
    deleteMenuGroup: async (req, res, next) => {
        try {
            const { id } = req.params;
            
            await menuManagementDao.deleteMenuGroup(id, req.user.User_Name);

            res.json({
                success: true,
                message: 'Menu group deleted successfully'
            });

        } catch (error) {
            console.error('Error deleting menu group:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete menu group: ' + error.message
            });
        }
    },

    // GET: Menu access permissions
    getMenuAccess: async (req, res, next) => {
        try {
            const roles = await menuManagementDao.getAllRoles();
            const accessData = await menuManagementDao.getMenuAccessMatrix(req.user.location_code);

            res.json({
                success: true,
                roles: roles,
                access: accessData
            });

        } catch (error) {
            console.error('Error fetching menu access:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch menu access: ' + error.message
            });
        }
    },

    // UPDATE: Menu access permissions
    updateMenuAccess: async (req, res, next) => {
        try {
            const { role, menu_code, allowed, isOverride, location_code } = req.body;
            
            if (isOverride) {
                await menuManagementDao.updateOverrideMenuAccess(
                    role, location_code, menu_code, allowed, req.user.User_Name
                );
            } else {
                await menuManagementDao.updateGlobalMenuAccess(
                    role, menu_code, allowed, req.user.User_Name
                );
            }

            res.json({
                success: true,
                message: 'Menu access updated successfully'
            });

        } catch (error) {
            console.error('Error updating menu access:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update menu access: ' + error.message
            });
        }
    },

    // GET: Raw global access rules
    getGlobalAccess: async (req, res, next) => {
        try {
            const [roles, menuItems, access] = await Promise.all([
                menuManagementDao.getAllRoles(),
                menuManagementDao.getAllMenuItems(),
                menuManagementDao.getAllGlobalAccess()
            ]);
            res.json({ success: true, roles, menuItems, access });
        } catch (error) {
            console.error('Error fetching global access:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST: Create/upsert a global access rule
    createGlobalAccess: async (req, res, next) => {
        try {
            const { role, menu_code, allowed } = req.body;
            await menuManagementDao.updateGlobalMenuAccess(role, menu_code, allowed, req.user.User_Name);
            res.json({ success: true, message: 'Global access rule saved' });
        } catch (error) {
            console.error('Error creating global access:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // DELETE: Soft-delete a global access rule
    deleteGlobalAccess: async (req, res, next) => {
        try {
            await menuManagementDao.deleteGlobalAccess(req.params.id, req.user.User_Name);
            res.json({ success: true, message: 'Global access rule removed' });
        } catch (error) {
            console.error('Error deleting global access:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // GET: Raw override rules — all locations for SuperUser, assigned locations for
    // PartnerAdmin, own location otherwise. Roles/menu items are also trimmed for
    // non-SuperUser callers: they can't touch SuperUser's menu access or platform-only
    // menu items (billing, dev tooling, usage stats, user-location assignment).
    getOverrides: async (req, res, next) => {
        try {
            const isSuperUser = req.user.Role === 'SuperUser';
            const accessibleLocations = security.getAccessibleLocations(req.user); // null | array
            const canPickLocation = Array.isArray(accessibleLocations) && accessibleLocations.length > 1;

            const [roles, menuItems, access] = await Promise.all([
                menuManagementDao.getAllRoles(),
                menuManagementDao.getAllMenuItems(),
                isSuperUser
                    ? menuManagementDao.getAllOverridesAll()
                    : menuManagementDao.getAllOverrides(canPickLocation ? accessibleLocations : req.user.location_code)
            ]);

            const visibleRoles = isSuperUser ? roles : roles.filter(r => r.role_name !== 'SuperUser');
            const visibleMenuItems = isSuperUser ? menuItems : menuItems.filter(m => !isPlatformOnlyMenuItem(m));

            res.json({
                success: true,
                roles: visibleRoles,
                menuItems: visibleMenuItems,
                access,
                location: req.user.location_code,
                isSuperUser,
                canPickLocation,
                accessibleLocations: canPickLocation ? accessibleLocations : null
            });
        } catch (error) {
            console.error('Error fetching overrides:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST: Create/upsert a location override
    createOverride: async (req, res, next) => {
        try {
            const { role, menu_code, allowed, location_code } = req.body;
            const isSuperUser = req.user.Role === 'SuperUser';

            if (!isSuperUser && role === 'SuperUser') {
                return res.status(403).json({ success: false, error: 'You cannot set menu access for the SuperUser role.' });
            }

            let targetLocation;
            if (isSuperUser) {
                targetLocation = location_code || req.user.location_code;
            } else {
                const accessibleLocations = security.getAccessibleLocations(req.user); // array (never null here)
                if (location_code) {
                    if (!accessibleLocations.includes(location_code)) {
                        return res.status(403).json({ success: false, error: 'You can only set menu access for your assigned location(s).' });
                    }
                    targetLocation = location_code;
                } else if (accessibleLocations.length === 1) {
                    targetLocation = accessibleLocations[0];
                } else {
                    return res.status(400).json({ success: false, error: 'A location is required.' });
                }
            }

            const menuItem = (await menuManagementDao.getAllMenuItems()).find(m => m.menu_code === menu_code);
            if (!isSuperUser && menuItem && isPlatformOnlyMenuItem(menuItem)) {
                return res.status(403).json({ success: false, error: 'You cannot set menu access for this menu item.' });
            }

            await menuManagementDao.updateOverrideMenuAccess(
                role, targetLocation, menu_code, allowed, req.user.User_Name
            );
            res.json({ success: true, message: 'Override saved' });
        } catch (error) {
            console.error('Error creating override:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // DELETE: Soft-delete a location override
    deleteOverride: async (req, res, next) => {
        try {
            const isSuperUser = req.user.Role === 'SuperUser';
            if (!isSuperUser) {
                const existing = await menuManagementDao.getOverrideById(req.params.id);
                if (!existing) {
                    return res.status(404).json({ success: false, error: 'Override not found' });
                }
                if (!security.canAccessLocation(req.user, existing.location_code)) {
                    return res.status(403).json({ success: false, error: 'You can only remove overrides for your assigned location(s).' });
                }
            }

            await menuManagementDao.deleteOverride(req.params.id, req.user.User_Name);
            res.json({ success: true, message: 'Override removed' });
        } catch (error) {
            console.error('Error deleting override:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // GET: Cache stats
    getCacheStats: async (req, res, next) => {
        try {
            const stats = await menuManagementDao.getCacheStats();
            res.json({ success: true, stats });
        } catch (error) {
            console.error('Error fetching cache stats:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // POST: Refresh menu cache
    refreshCache: async (req, res, next) => {
        try {
            const result = await menuManagementDao.refreshMenuCache();
            const lastRefresh = await menuManagementDao.getLastCacheRefresh();

            res.json({
                success: true,
                message: 'Menu cache refreshed successfully',
                result: result[0] || {},
                lastRefresh: lastRefresh[0] || null
            });

        } catch (error) {
            console.error('Error refreshing menu cache:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to refresh menu cache: ' + error.message
            });
        }
    },

    // Render access report page
renderAccessReport: async (req, res, next) => {
    try {
        res.render('menu-access-report', {
            title: 'Menu Access Report',
            user: req.user,
            location: req.user.location_code
        });
    } catch (error) {
        console.error('Error rendering menu access report:', error);
        res.status(500).send('Error loading menu access report');
    }
},

// GET: Access report data for current location
getAccessReportData: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const roles = await menuManagementDao.getAllRoles();
        const reportData = await menuManagementDao.getAccessReportMatrix(locationCode);

        res.json({
            success: true,
            location: locationCode,
            roles: roles,
            data: reportData
        });

    } catch (error) {
        console.error('Error fetching access report:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch access report: ' + error.message
        });
    }
},

    
};

module.exports = menuManagementController;