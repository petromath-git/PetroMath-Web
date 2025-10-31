const VersionRoutingDao = require('../dao/version-routing-dao');

/**
 * Handles version routing logic for both stable and canary apps
 * @param {Object} user - User object with location_code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {boolean} - true if redirect happened, false if should continue
 */
async function handleVersionRouting(user, req, res) {
    try {
        const version = await VersionRoutingDao.getCurrentVersion(user.location_code);
        const currentAppVersion = process.env.APP_VERSION || 'stable';
        const currentHost = req.get('host');
        
        console.log(`Version routing for ${user.location_code}: ${version}, Current app: ${currentAppVersion}, Host: ${currentHost}`);
        
        // If user's assigned version doesn't match current app
        if (version !== currentAppVersion) {
            let redirectUrl;
            
            if (version === 'canary') {
                // User should be on canary, redirect from stable to canary
                if (currentHost.includes('dev.')) {
                    redirectUrl = 'http://beta.dev.petromath.co.in/home';
                } else {
                    redirectUrl = 'http://beta.petromath.co.in/home';
                }
                console.log(`Redirecting ${user.location_code} to canary: ${redirectUrl}`);
            } else {
                // User should be on stable, redirect from canary to stable
                if (currentHost.includes('beta.dev.')) {
                    redirectUrl = 'http://dev.petromath.co.in/home';
                } else if (currentHost.includes('beta.')) {
                    redirectUrl = 'http://petromath.co.in/home';
                } else {
                    // Already on correct stable app, shouldn't happen
                    return false;
                }
                console.log(`Redirecting ${user.location_code} to stable: ${redirectUrl}`);
            }
            
            res.redirect(redirectUrl);
            return true; // Redirect happened
        }
        
        console.log(`User ${user.location_code} authorized for ${currentAppVersion} app`);
        return false; // No redirect, continue with normal flow
        
    } catch (error) {
        console.error("Error in version routing:", error);
        
        // On error, redirect canary users to stable for safety
        if (process.env.APP_VERSION === 'canary') {
            const currentHost = req.get('host');
            if (currentHost.includes('beta.dev.')) {
                res.redirect('http://dev.petromath.co.in/login');
            } else if (currentHost.includes('beta.')) {
                res.redirect('http://petromath.co.in/login');
            }
            return true;
        }
        
        return false; // Continue with stable app on error
    }
}

module.exports = {
    handleVersionRouting
};