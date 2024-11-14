
const config = require("../config/app-config");

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
    }
}