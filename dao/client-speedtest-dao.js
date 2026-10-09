const db = require("../db/db-connection");
const Sequelize = require("sequelize");

module.exports = {
    // Store one speed test run; returns the new speedtest_id (shown to the user as the result code)
    create: async (row) => {
        const [id] = await db.sequelize.query(`
            INSERT INTO t_client_speedtest (
                request_id, source,
                person_id, user_name, location_code, ip_address, user_agent,
                ping_avg_ms, ping_min_ms, jitter_ms, server_avg_ms,
                download_mbps, upload_mbps, failed_pings, connection_type,
                verdict, details_json
            ) VALUES (
                :request_id, :source,
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
    findRecent: async ({ speedtestId, locationCode, requestId, limit = 200 }) => {
        const where = [];
        const replacements = { limit };
        if (speedtestId) { where.push('speedtest_id = :speedtestId'); replacements.speedtestId = speedtestId; }
        if (locationCode) { where.push('location_code = :locationCode'); replacements.locationCode = locationCode; }
        if (requestId) { where.push('request_id = :requestId'); replacements.requestId = requestId; }
        return db.sequelize.query(`
            SELECT speedtest_id, request_id, source, person_id, user_name, location_code, ip_address, user_agent,
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
    },

    // ---- Remote requests (t_diag_request) ----

    // Latest active request covering this user: one for them personally, or one for their whole location
    findActiveRequestForUser: async (personId, locationCode) => {
        const rows = await db.sequelize.query(`
            SELECT request_id
            FROM t_diag_request
            WHERE status = 'ACTIVE'
              AND expires_at > NOW()
              AND (person_id = :personId OR (person_id IS NULL AND location_code = :locationCode))
            ORDER BY request_id DESC
            LIMIT 1
        `, {
            replacements: { personId, locationCode },
            type: Sequelize.QueryTypes.SELECT
        });
        return rows.length ? rows[0].request_id : null;
    },

    // The request row, if it is still active and applies to this user
    findApplicableRequest: async (requestId, personId, locationCode) => {
        const rows = await db.sequelize.query(`
            SELECT request_id
            FROM t_diag_request
            WHERE request_id = :requestId
              AND status = 'ACTIVE'
              AND expires_at > NOW()
              AND (person_id = :personId OR (person_id IS NULL AND location_code = :locationCode))
        `, {
            replacements: { requestId, personId, locationCode },
            type: Sequelize.QueryTypes.SELECT
        });
        return rows.length ? rows[0] : null;
    },

    // Has this user already run an AUTO test for this request in the last N minutes?
    hasRecentAutoRun: async (requestId, personId, minutes) => {
        const rows = await db.sequelize.query(`
            SELECT 1
            FROM t_client_speedtest
            WHERE request_id = :requestId
              AND person_id = :personId
              AND created_at > NOW() - INTERVAL :minutes MINUTE
            LIMIT 1
        `, {
            replacements: { requestId, personId, minutes },
            type: Sequelize.QueryTypes.SELECT
        });
        return rows.length > 0;
    },

    createRequest: async ({ personId, locationCode, note, hours, createdBy }) => {
        const [id] = await db.sequelize.query(`
            INSERT INTO t_diag_request (person_id, location_code, note, status, expires_at, created_by)
            VALUES (:personId, :locationCode, :note, 'ACTIVE', NOW() + INTERVAL :hours HOUR, :createdBy)
        `, {
            replacements: { personId, locationCode, note, hours, createdBy },
            type: Sequelize.QueryTypes.INSERT
        });
        return id;
    },

    cancelRequest: async (requestId) => {
        await db.sequelize.query(`
            UPDATE t_diag_request SET status = 'CANCELLED'
            WHERE request_id = :requestId AND status = 'ACTIVE'
        `, {
            replacements: { requestId },
            type: Sequelize.QueryTypes.UPDATE
        });
    },

    // Requests still running (plus the last day's ended ones) for the results screen
    findRecentRequests: async () => {
        return db.sequelize.query(`
            SELECT r.request_id, r.person_id, r.location_code, r.note, r.status,
                   r.expires_at, r.created_by, r.created_at,
                   p.User_Name AS user_name, p.Person_Name AS person_name,
                   (r.status = 'ACTIVE' AND r.expires_at > NOW()) AS is_active,
                   (SELECT COUNT(*) FROM t_client_speedtest s WHERE s.request_id = r.request_id) AS run_count,
                   (SELECT MAX(s.created_at) FROM t_client_speedtest s WHERE s.request_id = r.request_id) AS last_run_at
            FROM t_diag_request r
            LEFT JOIN m_persons p ON p.Person_id = r.person_id
            WHERE (r.status = 'ACTIVE' AND r.expires_at > NOW())
               OR r.created_at > NOW() - INTERVAL 7 DAY
            ORDER BY r.request_id DESC
            LIMIT 50
        `, { type: Sequelize.QueryTypes.SELECT });
    },

    // Active users who can log in to a location (home location or m_person_location)
    findUsersForLocation: async (locationCode) => {
        return db.sequelize.query(`
            SELECT p.Person_id AS person_id, p.Person_Name AS person_name, p.User_Name AS user_name, p.Role AS role
            FROM m_persons p
            WHERE p.effective_end_date > CURDATE()
              AND p.User_Name IS NOT NULL
              AND p.Role <> 'Customer'
              AND (p.location_code = :locationCode
                   OR p.Person_id IN (SELECT pl.person_id FROM m_person_location pl
                                      WHERE pl.location_code = :locationCode
                                        AND pl.effective_end_date >= CURDATE()))
            ORDER BY p.Person_Name
        `, {
            replacements: { locationCode },
            type: Sequelize.QueryTypes.SELECT
        });
    }
};
