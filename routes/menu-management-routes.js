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

// The routes below (menu items/groups, the legacy menu-access matrix, global
// access, cache) affect every location and role in the system, not just the
// caller's own — SuperUser only, even though PowerUser also holds
// MANAGE_MENU_SYSTEM (for the Location Overrides endpoints further down).

// API: Get all menu items
router.get('/api/menu-items', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.getMenuItems
);

// API: Create new menu item
router.post('/api/menu-items', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.createMenuItem
);

// API: Update menu item
router.put('/api/menu-items/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.updateMenuItem
);

// API: Delete menu item
router.delete('/api/menu-items/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.deleteMenuItem
);

// API: Get all menu groups
router.get('/api/menu-groups', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.getMenuGroups
);

// API: Create new menu group
router.post('/api/menu-groups', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.createMenuGroup
);

// API: Update menu group
router.put('/api/menu-groups/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.updateMenuGroup
);

// API: Delete menu group
router.delete('/api/menu-groups/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.deleteMenuGroup
);

// API: Get menu access matrix (legacy — superseded by /api/global-access + /api/overrides,
// kept for backward compatibility; not used by the current UI)
router.get('/api/menu-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.getMenuAccess
);

// API: Update menu access permissions (legacy — see above; can write GLOBAL rules,
// so must stay SuperUser-only regardless of MANAGE_MENU_SYSTEM)
router.put('/api/menu-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.updateMenuAccess
);

// API: Refresh menu cache
router.post('/api/refresh-cache', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.refreshCache
);

// API: Global access rules (raw m_menu_access_global)
router.get('/api/global-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.getGlobalAccess
);
router.post('/api/global-access', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.createGlobalAccess
);
router.delete('/api/global-access/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.deleteGlobalAccess
);

// API: Location overrides (raw m_menu_access_override, scoped to current user location)
router.get('/api/overrides', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')],
    menuManagementController.getOverrides
);
router.post('/api/overrides', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')],
    menuManagementController.createOverride
);
router.delete('/api/overrides/:id', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')],
    menuManagementController.deleteOverride
);

// API: Cache stats
router.get('/api/cache-stats', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM'), security.isSuperUser()],
    menuManagementController.getCacheStats
);


// Menu Access Report page
router.get('/access-report', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.renderAccessReport
);

// API: Get access report data
router.get('/api/access-report', [isLoginEnsured, security.hasPermission('MANAGE_MENU_SYSTEM')], 
    menuManagementController.getAccessReportData
);

module.exports = router;