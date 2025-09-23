// utils/route-logger.js
const db = require("../db/db-connection");

// Routes to exclude from logging (static assets, APIs that are called frequently)
const EXCLUDED_ROUTES = [
    '/stylesheets/',
    '/javascripts/',
    '/images/',
    '/favicon.ico',
    '/api/metrics',
    '/api/system-health',
    '/ping',
    '/health'
];

// Pages that should be logged with their friendly names
const PAGE_TITLES = {
    '/': 'Home Dashboard',
    '/home': 'Home Dashboard',
    '/login': 'Login Page',
    '/select-location': 'Location Selection',
    '/shift-closing': 'Shift Closing',
    '/credit-sales': 'Credit Sales Entry',
    '/cash-sales': 'Cash Sales Entry',
    '/products': 'Products Master',
    '/reports': 'Reports',
    '/mileage/dashboard': 'Mileage Dashboard',
    '/system-health/dashboard': 'System Health Monitor',
    '/usage-dashboard': 'Usage Dashboard',
    '/transaction-corrections': 'Transaction Corrections',
    '/bills': 'Bills Management',
    '/tanks': 'Tank Management',
    '/expenses': 'Expense Entry'
};

/**
 * Middleware to log route access for analytics
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether logging is enabled (default: true)
 * @param {Array} options.excludeRoutes - Additional routes to exclude
 */
function routeLogger(options = {}) {
    const enabled = options.enabled !== false; // Default to true
    const additionalExcludes = options.excludeRoutes || [];
    const excludedRoutes = [...EXCLUDED_ROUTES, ...additionalExcludes];

    return (req, res, next) => {
        // Always call next() first to ensure request continues regardless of logging issues
        next();

        // Skip logging if disabled or conditions not met
        if (!enabled) return;
        
        const shouldSkip = excludedRoutes.some(excluded => 
            req.path.includes(excluded)
        );
        if (shouldSkip) return;
        
        if (!req.user) return;

        // Capture start time for response time calculation
        const startTime = Date.now();

        // Override res.end to capture when response is sent
        const originalEnd = res.end;
        res.end = function(...args) {
            const responseTime = Date.now() - startTime;
            
            // Log asynchronously with full error isolation
            setImmediate(() => {
                try {
                    logRouteAccess(req, responseTime);
                } catch (error) {
                    // Completely isolate logging errors - never let them bubble up
                    console.error('[ROUTE LOGGER] Silent error (app unaffected):', error.message);
                }
            });

            // Call original end method
            originalEnd.apply(this, args);
        };
    };
}

/**
 * Log route access to database
 * @param {Object} req - Express request object
 * @param {number} responseTime - Response time in milliseconds
 */
async function logRouteAccess(req, responseTime) {
    try {
        // Get friendly page title
        const pageTitle = PAGE_TITLES[req.path] || PAGE_TITLES[req.route?.path] || 'Unknown Page';
        
        // Get user info
        const user = req.user;
        const sessionId = req.sessionID;

        // Prepare log data
        const logData = {
            person_id: user.Person_id || null,
            location_code: user.location_code || null,
            route_path: req.path,
            route_method: req.method,
            page_title: pageTitle,
            session_id: sessionId,
            response_time_ms: responseTime
        };

        // Insert into database using raw query
        const query = `
            INSERT INTO t_user_activity_log (
                person_id, location_code, route_path, route_method, 
                page_title, session_id, response_time_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        await db.sequelize.query(query, {
            replacements: [
                logData.person_id,
                logData.location_code,
                logData.route_path,
                logData.route_method,
                logData.page_title,
                logData.session_id,
                logData.response_time_ms
            ]
        });

        // Basic success log in development only
        if (process.env.NODE_ENV === 'development') {
            console.log(`[ROUTE LOG] ${user.User_Name} (${logData.location_code}) → ${logData.route_path} (${responseTime}ms)`);
        }

    } catch (error) {
        // Never let logging errors affect the application
        console.error('[ROUTE LOGGER] Error (app unaffected):', error.message);
    }
}

/**
 * Get page title for a given route
 * @param {string} routePath - The route path
 * @returns {string} - Friendly page title
 */
function getPageTitle(routePath) {
    return PAGE_TITLES[routePath] || 'Unknown Page';
}

/**
 * Add a new page title mapping
 * @param {string} route - Route path
 * @param {string} title - Friendly title
 */
function addPageTitle(route, title) {
    PAGE_TITLES[route] = title;
}

module.exports = {
    routeLogger,
    getPageTitle,
    addPageTitle,
    PAGE_TITLES
};