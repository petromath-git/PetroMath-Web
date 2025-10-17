const fs = require("fs");
const path = require("path");
const config = require("../config/app-config");
const rolePermissionsDao = require("../dao/role-permissions-dao");

const publicDir = path.join(__dirname, "..", "public");

module.exports = {
    // 🔹 Middleware to enforce admin-only access
    isAdmin: () => {
        return (req, res, next) => {
            if (config.APP_CONFIGS.adminRoles.includes(req.user.Role)) {
                return next();
            }
            res.status(403).send('You do not have access to this page.');
        };
    },

    // 🔹 Quick admin check for internal use
    isAdminChk: (user) => config.APP_CONFIGS.adminRoles.includes(user.Role),

    // 🔹 Block customers from restricted routes
    isNotCustomer: () => {
        return (req, res, next) => {
            if (req.user && req.user.Role === 'Customer') {
                return res.status(403).send('Access Denied: Customers are not allowed to access this page.');
            }
            next();
        };
    },

    // 🔹 Permission-based access
    hasPermission: (permissionType) => {
        return async (req, res, next) => {
            try {
                const userRole = req.user?.Role;
                const userLocation = req.user?.location_code;
                if (!userRole || !userLocation) {
                    return res.status(403).send('Access Denied: Invalid user session.');
                }
                const hasPermission = await rolePermissionsDao.hasPermission(
                    userRole,
                    userLocation,
                    permissionType
                );
                if (hasPermission) return next();
                res.status(403).send(`Access Denied: You do not have permission for ${permissionType}.`);
            } catch (error) {
                console.error(`Error checking permission ${permissionType}:`, error);
                res.status(500).send('Internal server error while checking permissions.');
            }
        };
    },

    // 🔹 Global app hardening middleware
    secureApp: (app) => {
        // Hide Express fingerprint
        app.disable('x-powered-by');

        // Block directory browsing
        app.use((req, res, next) => {
            const requestedPath = path.join(publicDir, req.path);
            try {
                if (fs.existsSync(requestedPath) && fs.lstatSync(requestedPath).isDirectory()) {
                    return res.status(403).render('403', { message: 'Directory access is not allowed.' });
                }
            } catch (_) {}
            next();
        });

        // Block disallowed extensions (prevent config/code leaks)
        app.use((req, res, next) => {
            const forbiddenPatterns = [
                /\.env$/, /\.git/, /\.sql$/, /\.bak$/, /\.zip$/, /\.json$/, /\.md$/, /\.yml$/, /\.yaml$/
            ];
            if (forbiddenPatterns.some((p) => p.test(req.path.toLowerCase()))) {
                return res.status(403).send('Forbidden file access');
            }
            next();
        });

        // Sanitize paths (prevent traversal attacks)
        app.use((req, res, next) => {
            if (req.path.includes("..")) {
                return res.status(400).send("Bad Request");
            }
            next();
        });
    }
};
