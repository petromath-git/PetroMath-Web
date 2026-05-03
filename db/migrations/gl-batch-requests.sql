-- ============================================================
-- GL Batch Requests — Concurrent Request Table
-- Generated: 2026-05-03
--
-- Tracks Generate Events and Create Accounting runs.
-- Stores per-run logs, result summary, and status lifecycle.
-- Log verbosity controlled by GL_LOG_LEVEL in m_location_config.
-- Run on dev and prod.
-- ============================================================

CREATE TABLE IF NOT EXISTS gl_batch_requests (
    request_id      INT          NOT NULL AUTO_INCREMENT,
    request_type    VARCHAR(50)  NOT NULL,           -- GENERATE_EVENTS | CREATE_ACCOUNTING
    location_code   VARCHAR(20)  NOT NULL,
    from_date       DATE         NOT NULL,
    to_date         DATE         NOT NULL,
    params          JSON,                            -- extra params e.g. {reprocess: true}
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING|RUNNING|COMPLETED|ERROR
    submitted_by    VARCHAR(100),
    submitted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME,
    completed_at    DATETIME,
    result_summary  JSON,                            -- {processed, errors, blocked, counts...}
    log_text        LONGTEXT,                        -- full run log
    PRIMARY KEY (request_id),
    KEY idx_gbr_location_status (location_code, status),
    KEY idx_gbr_submitted_at    (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Default log level (INFO) — insert only if not already present ─────────────
-- GL_LOG_LEVEL values: DEBUG | INFO | ERROR
-- DEBUG: per-event detail (verbose), INFO: summaries + errors, ERROR: errors only

INSERT IGNORE INTO m_location_config (location_code, setting_name, setting_value, created_by, updated_by)
SELECT '*', 'GL_LOG_LEVEL', 'INFO', 'system', 'system'
WHERE NOT EXISTS (
    SELECT 1 FROM m_location_config WHERE location_code = '*' AND setting_name = 'GL_LOG_LEVEL'
);

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SHOW COLUMNS FROM gl_batch_requests;
SELECT location_code, setting_name, setting_value FROM m_location_config WHERE setting_name = 'GL_LOG_LEVEL';
