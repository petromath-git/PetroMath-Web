const db = require("../db/db-connection");

async function getLocationConfigValue(locationCode, settingName, defaultValue = null) {
    try {
        const query = `
            SELECT setting_value 
            FROM m_location_config 
            WHERE setting_name = ? 
            AND (location_code = ? OR location_code = '*')
            AND CURDATE() BETWEEN effective_start_date AND effective_end_date
            ORDER BY CASE WHEN location_code = ? THEN 1 ELSE 2 END
            LIMIT 1
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: [settingName, locationCode, locationCode],
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        if (result.length > 0 && result[0].setting_value != null) {
            return result[0].setting_value.trim();
        }

        return defaultValue;
        
    } catch (error) {
        console.error('Error fetching location config:', error);
        return defaultValue;
    }
}

module.exports = {
    getLocationConfigValue
};