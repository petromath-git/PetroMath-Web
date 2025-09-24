// controllers/usage-dashboard-controller.js
const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    
    // Main dashboard page
    getUsageDashboard: async (req, res, next) => {
        try {
            // Get initial overview data for page load
            const overviewData = await getUsageOverviewData();
            
            res.render('usage-dashboard', {
                title: 'Application Usage Dashboard',
                user: req.user,
                initialData: JSON.stringify(overviewData),
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getUsageDashboard:', error);
            req.flash('error', 'Failed to load usage dashboard: ' + error.message);
            res.redirect('/home');
        }
    },

    // API: Usage overview stats
    getUsageOverview: async (req, res) => {
        try {
            const data = await getUsageOverviewData();
            res.json({
                success: true,
                data: data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error in getUsageOverview:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch usage overview: ' + error.message
            });
        }
    },

    // API: Location-wise statistics
   // API: Location-wise statistics
getLocationStats: async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '7'; // days
        
        let whereClause;
        if (timeframe === '1') {
            // Today only - from start of current day
            whereClause = `access_timestamp >= DATE(NOW()) AND access_timestamp < DATE_ADD(DATE(NOW()), INTERVAL 1 DAY)`;
        } else {
            // Last X days
            whereClause = `access_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeframe} DAY)`;
        }
        
        const query = `
            SELECT 
                location_code,
                COUNT(*) as total_page_views,
                COUNT(DISTINCT person_id) as unique_users,
                COUNT(DISTINCT session_id) as unique_sessions,
                AVG(response_time_ms) as avg_response_time,
                COUNT(DISTINCT DATE(access_timestamp)) as active_days
            FROM t_user_activity_log 
            WHERE ${whereClause}
              AND route_path NOT LIKE '/usage-dashboard%'
              AND person_id != 758
            GROUP BY location_code
            ORDER BY total_page_views DESC
        `;

        const results = await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });

        res.json({
            success: true,
            data: results,
            timeframe: timeframe === '1' ? 'today' : timeframe + ' days',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getLocationStats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch location stats: ' + error.message
        });
    }
},
    // API: Feature usage patterns
   // API: Feature usage patterns
getFeatureUsage: async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '7'; // days
        
        let whereClause;
        if (timeframe === '1') {
            // Today only - from start of current day
            whereClause = `access_timestamp >= DATE(NOW()) AND access_timestamp < DATE_ADD(DATE(NOW()), INTERVAL 1 DAY)`;
        } else {
            // Last X days
            whereClause = `access_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeframe} DAY)`;
        }
        
        const query = `
            SELECT 
                page_title,
                route_path,
                COUNT(*) as page_views,
                COUNT(DISTINCT person_id) as unique_users,
                AVG(response_time_ms) as avg_response_time
            FROM t_user_activity_log 
            WHERE ${whereClause}
              AND route_path NOT LIKE '/usage-dashboard%'
            GROUP BY page_title, route_path
            ORDER BY page_views DESC
            LIMIT 20
        `;

        const results = await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });

        res.json({
            success: true,
            data: results,
            timeframe: timeframe === '1' ? 'today' : timeframe + ' days',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getFeatureUsage:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch feature usage: ' + error.message
        });
    }
},

    
   // API: Time-based usage patterns
getTimePatterns: async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '7'; // days
        
        let whereClause;
        if (timeframe === '1') {
            // Today only - from start of current day
            whereClause = `access_timestamp >= DATE(NOW()) AND access_timestamp < DATE_ADD(DATE(NOW()), INTERVAL 1 DAY)`;
        } else {
            // Last X days
            whereClause = `access_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeframe} DAY)`;
        }
        
        const query = `
            SELECT 
                HOUR(access_timestamp) as hour_of_day,
                COUNT(*) as page_views,
                COUNT(DISTINCT person_id) as unique_users,
                COUNT(DISTINCT session_id) as unique_sessions
            FROM t_user_activity_log 
            WHERE ${whereClause}
              AND route_path NOT LIKE '/usage-dashboard%'
            GROUP BY HOUR(access_timestamp)
            ORDER BY hour_of_day
        `;

        const results = await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });

        res.json({
            success: true,
            data: results,
            timeframe: timeframe === '1' ? 'today' : timeframe + ' days',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getTimePatterns:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch time patterns: ' + error.message
        });
    }
},

    // API: User activity summary
   // API: User activity summary
getUserActivity: async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '7'; // days
        
        let whereClause;
        if (timeframe === '1') {
            // Today only - from start of current day
            whereClause = `ual.access_timestamp >= DATE(NOW()) AND ual.access_timestamp < DATE_ADD(DATE(NOW()), INTERVAL 1 DAY)`;
        } else {
            // Last X days
            whereClause = `ual.access_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeframe} DAY)`;
        }
        
        const query = `
            SELECT 
                ual.person_id,
                mp.User_Name,
                mp.Role,
                ual.location_code,
                COUNT(*) as total_page_views,
                COUNT(DISTINCT ual.route_path) as unique_pages_visited,
                MAX(ual.access_timestamp) as last_activity,
                AVG(ual.response_time_ms) as avg_response_time
            FROM t_user_activity_log ual
            LEFT JOIN m_persons mp ON ual.person_id = mp.Person_id
            WHERE ${whereClause}
              AND ual.route_path NOT LIKE '/usage-dashboard%'
              AND ual.person_id != 758
            GROUP BY ual.person_id, mp.User_Name, mp.Role, ual.location_code
            ORDER BY total_page_views DESC
            LIMIT 50
        `;

        const results = await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });

        res.json({
            success: true,
            data: results,
            timeframe: timeframe === '1' ? 'today' : timeframe + ' days',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getUserActivity:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user activity: ' + error.message
        });
    }
},

    // Export usage data as CSV
    exportUsageData: async (req, res) => {
        try {
            const timeframe = req.query.timeframe || '30'; // days
            
            const query = `
                SELECT 
                    ual.access_timestamp,
                    ual.person_id,
                    mp.User_Name,
                    mp.Role,
                    ual.location_code,
                    ual.route_path,
                    ual.page_title,
                    ual.response_time_ms
                FROM t_user_activity_log ual
                LEFT JOIN m_persons mp ON ual.person_id = mp.Person_id
                WHERE ual.access_timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)
                ORDER BY ual.access_timestamp DESC
            `;

            const results = await db.sequelize.query(query, {
                replacements: [timeframe],
                type: QueryTypes.SELECT
            });

            // Convert to CSV format
            const csvHeaders = ['Timestamp', 'User ID', 'Username', 'Role', 'Location', 'Route', 'Page Title', 'Response Time (ms)'];
            const csvRows = results.map(row => [
                row.access_timestamp,
                row.person_id,
                row.User_Name,
                row.Role,
                row.location_code,
                row.route_path,
                row.page_title,
                row.response_time_ms
            ]);

            const csvContent = [csvHeaders, ...csvRows]
                .map(row => row.map(field => `"${field}"`).join(','))
                .join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="usage-data-${timeframe}days.csv"`);
            res.send(csvContent);

        } catch (error) {
            console.error('Error in exportUsageData:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to export usage data: ' + error.message
            });
        }
    }
};

// Helper function to get overview data
async function getUsageOverviewData() {
    try {
        // Today's stats
        const todayQuery = `
            SELECT 
                COUNT(*) as total_page_views_today,
                COUNT(DISTINCT person_id) as unique_users_today,
                COUNT(DISTINCT location_code) as active_locations_today,
                COUNT(DISTINCT session_id) as unique_sessions_today,
                AVG(response_time_ms) as avg_response_time_today
            FROM t_user_activity_log 
            WHERE DATE(access_timestamp) = CURDATE()
            AND person_id != 758
        `;

        // Week's stats
        const weekQuery = `
            SELECT 
                COUNT(*) as total_page_views_week,
                COUNT(DISTINCT person_id) as unique_users_week,
                COUNT(DISTINCT location_code) as active_locations_week
            FROM t_user_activity_log 
            WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND person_id != 758
        `;

        // Most active locations
        const locationQuery = `
            SELECT 
                location_code,
                COUNT(*) as page_views
            FROM t_user_activity_log 
            WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND person_id != 758
            GROUP BY location_code
            ORDER BY page_views DESC
            LIMIT 10
        `;

        const [todayStats] = await db.sequelize.query(todayQuery, { type: QueryTypes.SELECT });
        const [weekStats] = await db.sequelize.query(weekQuery, { type: QueryTypes.SELECT });
        const locationStats = await db.sequelize.query(locationQuery, { type: QueryTypes.SELECT });

        return {
            today: todayStats,
            week: weekStats,
            topLocations: locationStats
        };

    } catch (error) {
        console.error('Error in getUsageOverviewData:', error);
        throw error;
    }
}