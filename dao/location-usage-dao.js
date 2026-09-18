const db = require("../db/db-connection");

module.exports = {
    getLocationUsageMatrix: () => {
        return db.sequelize.query(
            `SELECT
                l.location_code,
                l.location_name,
                l.start_date,
                l.effective_end_date,
                CASE WHEN l.effective_end_date > CURDATE() THEN 1 ELSE 0 END AS is_active_location,
                COUNT(c.closing_id) AS total_shifts,
                SUM(CASE WHEN c.closing_status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_shifts,
                SUM(CASE WHEN c.closing_status = 'DRAFT' THEN 1 ELSE 0 END) AS draft_shifts,
                MIN(c.closing_date) AS first_shift_date,
                MAX(c.closing_date) AS last_shift_date,
                DATEDIFF(CURDATE(), MAX(c.closing_date)) AS days_since_last_shift,
                SUM(CASE WHEN c.closing_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS shifts_last_30_days
             FROM m_location l
             LEFT JOIN t_closing c ON c.location_code = l.location_code
             GROUP BY l.location_id, l.location_code, l.location_name, l.start_date, l.effective_end_date
             ORDER BY
                CASE WHEN COUNT(c.closing_id) = 0 THEN 0 ELSE 1 END,
                DATEDIFF(CURDATE(), MAX(c.closing_date)) DESC,
                l.location_name`,
            { type: db.sequelize.QueryTypes.SELECT }
        );
    }
};
