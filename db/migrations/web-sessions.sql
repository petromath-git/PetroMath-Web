-- Logins kept in the database instead of server memory, so deploys and PM2
-- restarts no longer log everyone out. Used by utils/db-session-store.js.
-- expires_ms is epoch milliseconds (compared in Node), so no timezone issues.
-- data is MEDIUMTEXT: the session holds the user's whole menu list.

CREATE TABLE IF NOT EXISTS t_web_sessions (
    session_id   VARCHAR(128)  NOT NULL,
    person_id    INT           DEFAULT NULL COMMENT 'NULL until logged in',
    expires_ms   BIGINT        NOT NULL,
    data         MEDIUMTEXT    NOT NULL,
    updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    KEY idx_web_sessions_expires (expires_ms),
    KEY idx_web_sessions_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
