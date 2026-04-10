const VersionRoutingDao = require('../dao/version-routing-dao');

/**
 * Handles version routing logic for both stable and canary apps
 * @param {Object} user - User object with location_code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {boolean} - true if redirect happened, false if should continue
 */
async function handleVersionRouting(user, req, res) {
    const currentAppVersion = process.env.APP_VERSION || 'stable';

    // On prod: no version routing — always proceed
    if (currentAppVersion !== 'canary') {
        return false;
    }

    // On beta: check if location has beta access
    try {
        const version = await VersionRoutingDao.getCurrentVersion(user.location_code);
        console.log(`Beta access check for ${user.location_code}: DB=${version}`);

        if (version !== 'canary') {
            console.log(`Location ${user.location_code} does not have beta access`);
            req.logout(function() {});
            req.flash('error', 'You do not have access to the beta application.');
            res.redirect('/login');
            return true;
        }

        // Location has beta access — proceed
        return false;

    } catch (error) {
        console.error('Error in version routing:', error);
        return false;
    }
}

module.exports = { handleVersionRouting };
