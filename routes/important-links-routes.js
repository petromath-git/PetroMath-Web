// routes/important-links-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const importantLinksController = require('../controllers/important-links-controller');

// Management page
router.get('/manage', [isLoginEnsured, security.hasPermission('MANAGE_IMPORTANT_LINKS')], 
    importantLinksController.renderManagementPage
);

// Viewing page (all logged-in users)
router.get('/', isLoginEnsured, 
    importantLinksController.renderViewingPage
);

// API: Create new link
router.post('/api/create', [isLoginEnsured, security.hasPermission('MANAGE_IMPORTANT_LINKS')], 
    importantLinksController.createLink
);

// API: Update link
router.put('/api/:id', [isLoginEnsured, security.hasPermission('MANAGE_IMPORTANT_LINKS')], 
    importantLinksController.updateLink
);

// API: Get link by ID
router.get('/api/:id', isLoginEnsured, 
    importantLinksController.getLinkById
);

// API: Toggle publish status
router.post('/api/:id/toggle-publish', [isLoginEnsured, security.hasPermission('MANAGE_IMPORTANT_LINKS')], 
    importantLinksController.togglePublish
);

// API: Get links for viewing (AJAX)
router.get('/api/list', isLoginEnsured, 
    importantLinksController.getLinksForViewing
);

module.exports = router;