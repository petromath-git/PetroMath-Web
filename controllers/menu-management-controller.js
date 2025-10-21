// controllers/menu-management-controller.js
const menuManagementDao = require('../dao/menu-management-dao');

const menuManagementController = {
    
    // Render the main menu management page
    renderPage: async (req, res, next) => {
        try {
            res.render('menu-management', {
                title: 'Menu Management',
                user: req.user,
                location: req.user.location_code
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