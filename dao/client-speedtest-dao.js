const db = require("../db/db-connection");
const Sequelize = require("sequelize");

module.exports = {
    // Store one speed test run; returns the new speedtest_id (shown to the user as the result code)
    create: async (row) => {
        const [id] = await db.sequelize.query(`
            INSERT INTO t_client_speedtest (
                person_id, user_name, location_code, ip_address, user_agent,
                ping_avg_ms, ping_min_ms, jitter_ms, server_avg_ms,
                download_mbps, upload_mbps, failed_pings, connection_type,
                verdict, details_json
            ) VALUES (
                :person_id, :user_name, :location_code, :ip_address, :user_agent,
                :ping_avg_ms, :ping_min_ms, :jitter_ms, :server_avg_ms,
                :download_mbps, :upload_mbps, :failed_pings, :connection_type,
                :verdict, :details_json
            )
        `, {
            replacements: row,
            type: Sequelize.QueryTypes.INSERT
        });
        return id;
    },

    // Recent runs for the SuperUser results screen, optionally filtered by code / location
    findRecent: async ({ speedtestId, locationCode, limit = 200 }) => {
        const where = [];
        const replacements = { limit };
        if (speedtestId) { where.push('speedtest_id = :speedtestId'); replacements.speedtestId = speedtestId; }
        if (locationCode) { where.push('location_code = :locationCode'); replacements.locationCode = locationCode; }
        return db.sequelize.query(`
            SELECT speedtest_id, person_id, user_name, location_code, ip_address, user_agent,
                   ping_avg_ms, ping_min_ms, jitter_ms, server_avg_ms,
                   download_mbps, upload_mbps, failed_pings, connection_type,
                   verdict, details_json, created_at
            FROM t_client_speedtest
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY speedtest_id DESC
            LIMIT :limit
        `, {
            replacements,
            type: Sequelize.QueryTypes.SELECT
        });
    }
};
