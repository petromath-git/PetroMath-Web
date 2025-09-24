// routes/menu-management-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const menuManagementController = require('../controllers/menu-management-controller');

// Main menu management page - render the UI
router.get('/', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.renderPage
);

// API: Get all menu items
router.get('/api/menu-items', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.getMenuItems
);

// API: Create new menu item
router.post('/api/menu-items', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.createMenuItem
);

// API: Update menu item
router.put('/api/menu-items/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.updateMenuItem
);

// API: Delete menu item
router.delete('/api/menu-items/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.deleteMenuItem
);

// API: Get all menu groups
router.get('/api/menu-groups', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.getMenuGroups
);

// API: Create new menu group
router.post('/api/menu-groups', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.createMenuGroup
);

// API: Update menu group
router.put('/api/menu-groups/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.updateMenuGroup
);

// API: Delete menu group
router.delete('/api/menu-groups/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.deleteMenuGroup
);

// API: Get menu access matrix
router.get('/api/menu-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.getMenuAccess
);

// API: Update menu access permissions
router.put('/api/menu-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.updateMenuAccess
);

// API: Refresh menu cache
router.post('/api/refresh-cache', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.refreshCache
);

module.exports = router;