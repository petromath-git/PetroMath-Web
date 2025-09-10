
const config = require("../config/app-config");
const rolePermissionsDao = require("../dao/role-permissions-dao");

module.exports = {
    isAdmin : () => {
        return (req, res, next) => {
            if(config.APP_CONFIGS.adminRoles.includes(req.user.Role)) {
                next();
            } else {
                res.status(403).send('You do not have access to the page.');
            }
        }
    },
    isAdminChk : (user) => {
        if(config.APP_CONFIGS.adminRoles.includes(user.Role)) {
            return true;
        }
        return false;
    },
    isNotCustomer: () => {
        return (req, res, next) => {
            if (req.user && req.user.Role === 'Customer') {
                // Block access for customers, send 403 or redirect them
                return res.status(403).send('Access Denied: Customers are not allowed to access this page.');
            }
            next();  // Proceed if the user is not a customer
        };
    },
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
            
            if (hasPermission) {
                next();
            } else {
                res.status(403).send(`Access Denied: You do not have permission for ${permissionType}.`);
            }
        } catch (error) {
            console.error(`Error checking permission ${permissionType}:`, error);
            res.status(500).send('Internal server error while checking permissions.');
        }
    }
}
}