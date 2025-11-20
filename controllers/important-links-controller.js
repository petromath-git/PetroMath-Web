// controllers/important-links-controller.js
const importantLinksDao = require('../dao/important-links-dao');
const locationDao = require('../dao/location-dao');

module.exports = {

    // Render management page
    renderManagementPage: async (req, res, next) => {
        try {
            const user = req.user;
            const userRole = user.Role;
            
            // Get all locations and find user's location
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            const userCompanyName = userLocation ? userLocation.company_name : null;
            
            // Get links based on user's permissions
            const links = await importantLinksDao.getLinksForManagement(
                userRole, 
                userLocationId, 
                userCompanyName
            );
            
            // Get dropdown data
            const categories = await importantLinksDao.getCategories();
            const oilCompanies = await importantLinksDao.getOilCompanies();
            const roles = await importantLinksDao.getRoles();
            
            // Get locations for dropdown (filtered by role)
            let availableLocations = [];
            if (userRole === 'SuperUser') {
                availableLocations = locations;
            } else if (userRole === 'Admin') {
                availableLocations = locations.filter(l => l.company_name === userCompanyName);
            } else {
                availableLocations = locations.filter(l => l.location_id === userLocationId);
            }
            
            res.render('important-links-manage', {
                title: 'Manage Important Links',
                user: user,
                links: links,
                categories: categories,
                oilCompanies: oilCompanies,
                roles: roles,
                locations: availableLocations,
                userRole: userRole,
                userLocationId: userLocationId,
                linksData: JSON.stringify(links),
                categoriesData: JSON.stringify(categories),
                oilCompaniesData: JSON.stringify(oilCompanies),
                rolesData: JSON.stringify(roles),
                locationsData: JSON.stringify(availableLocations)
            });
            
        } catch (error) {
            console.error('Error rendering important links management page:', error);
            next(error);
        }
    },

    // Render viewing page (published links)
    renderViewingPage: async (req, res, next) => {
        try {
            const user = req.user;
            const userRole = user.Role;
            
            // Get all locations and find user's location
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            const userCompanyName = userLocation ? userLocation.company_name : null;
            
            // Get user's role_id from roles table
            const roles = await importantLinksDao.getRoles();
            const userRoleData = roles.find(r => r.role_name === userRole);
            const userRoleId = userRoleData ? userRoleData.role_id : 0;
            
            // Get published links visible to this user
            const links = await importantLinksDao.getLinksForViewing(
                userRole,
                userRoleId,
                userLocationId,
                userCompanyName
            );
            
            // Group links by category
            const linksByCategory = {};
            links.forEach(link => {
                const category = link.category_name || 'Others';
                if (!linksByCategory[category]) {
                    linksByCategory[category] = [];
                }
                linksByCategory[category].push(link);
            });
            
            res.render('important-links-view', {
                title: 'Important Links',
                user: user,
                linksByCategory: linksByCategory,
                linksData: JSON.stringify(links)
            });
            
        } catch (error) {
            console.error('Error rendering important links viewing page:', error);
            next(error);
        }
    },

    // API: Create new link
    createLink: async (req, res) => {
        try {
            const user = req.user;
            const userRole = user.Role;
            
            // Get user's location_id
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            
            const linkData = {
                title: req.body.title,
                url: req.body.url,
                description: req.body.description,
                category_id: req.body.category_id,
                scope_type: req.body.scope_type,
                company_id: req.body.company_id || null,
                location_id: req.body.location_id || null,
                username: req.body.username,
                password: req.body.password,
                is_published: req.body.is_published === 'true' || req.body.is_published === true,
                display_order: req.body.display_order || 0,
                created_by: user.Person_id
            };
            
            const roleIds = req.body.role_ids || [];
            
            // Validate scope permissions
            if (linkData.scope_type === 'GLOBAL' && userRole !== 'SuperUser') {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Only SuperUser can create global links' 
                });
            }
            
            if (linkData.scope_type === 'COMPANY' && userRole !== 'SuperUser') {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Only SuperUser can create company-level links' 
                });
            }
            
            if (linkData.scope_type === 'LOCATION') {
                // Validate user can create for this location
                if (userRole === 'Manager' && parseInt(linkData.location_id) !== userLocationId) {
                    return res.status(403).json({ 
                        success: false, 
                        message: 'You can only create links for your own location' 
                    });
                }
            }
            
            const linkId = await importantLinksDao.create(linkData, roleIds);
            
            res.json({ 
                success: true, 
                message: 'Link created successfully',
                linkId: linkId 
            });
            
        } catch (error) {
            console.error('Error creating link:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error creating link: ' + error.message 
            });
        }
    },

    // API: Update link
    updateLink: async (req, res) => {
        try {
            const user = req.user;
            const linkId = req.params.id;
            
            // Get user's location_id
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            
            // Check permission
            const canModify = await importantLinksDao.canUserModifyLink(
                linkId, 
                user.Role, 
                userLocationId
            );
            
            if (!canModify) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'You do not have permission to modify this link' 
                });
            }
            
            const linkData = {
                title: req.body.title,
                url: req.body.url,
                description: req.body.description,
                category_id: req.body.category_id,
                scope_type: req.body.scope_type,
                company_id: req.body.company_id || null,
                location_id: req.body.location_id || null,
                username: req.body.username,
                password: req.body.password,
                is_published: req.body.is_published === 'true' || req.body.is_published === true,
                display_order: req.body.display_order || 0,
                updated_by: user.Person_id
            };
            
            const roleIds = req.body.role_ids || [];
            
            await importantLinksDao.update(linkId, linkData, roleIds);
            
            res.json({ 
                success: true, 
                message: 'Link updated successfully' 
            });
            
        } catch (error) {
            console.error('Error updating link:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error updating link: ' + error.message 
            });
        }
    },

    // API: Get link by ID
    getLinkById: async (req, res) => {
        try {
            const linkId = req.params.id;
            const link = await importantLinksDao.getById(linkId);
            
            if (!link) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Link not found' 
                });
            }
            
            res.json({ 
                success: true, 
                data: link 
            });
            
        } catch (error) {
            console.error('Error fetching link:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error fetching link: ' + error.message 
            });
        }
    },

    // API: Toggle publish status
    togglePublish: async (req, res) => {
        try {
            const user = req.user;
            const linkId = req.params.id;
            
            // Get user's location_id
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            
            // Check permission
            const canModify = await importantLinksDao.canUserModifyLink(
                linkId, 
                user.Role, 
                userLocationId
            );
            
            if (!canModify) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'You do not have permission to modify this link' 
                });
            }
            
            await importantLinksDao.togglePublish(linkId, user.Person_id);
            
            res.json({ 
                success: true, 
                message: 'Link status updated successfully' 
            });
            
        } catch (error) {
            console.error('Error toggling link status:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error updating link status: ' + error.message 
            });
        }
    },

    // API: Get links for viewing (AJAX)
    getLinksForViewing: async (req, res) => {
        try {
            const user = req.user;
            const userRole = user.Role;
            
            // Get all locations and find user's location
            const locations = await locationDao.findActiveLocations();
            const userLocation = locations.find(l => l.location_code === user.location_code);
            const userLocationId = userLocation ? userLocation.location_id : 0;
            const userCompanyName = userLocation ? userLocation.company_name : null;
            
            // Get user's role_id
            const roles = await importantLinksDao.getRoles();
            const userRoleData = roles.find(r => r.role_name === userRole);
            const userRoleId = userRoleData ? userRoleData.role_id : 0;
            
            const links = await importantLinksDao.getLinksForViewing(
                userRole,
                userRoleId,
                userLocationId,
                userCompanyName
            );
            
            res.json({ 
                success: true, 
                data: links 
            });
            
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error fetching links: ' + error.message 
            });
        }
    }
};