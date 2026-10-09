-- Remote speed test requests: support flags a user (or every user at a location)
-- from /speedtest/results, and the test then runs silently in that user's browser
-- on their next page load, at most once an hour until the request expires.
-- Additive only; run on prod too (beta DB is restored from prod every 4h).

CREATE TABLE IF NOT EXISTS t_diag_request (
    request_id      INT          NOT NULL AUTO_INCREMENT,
    person_id       INT          DEFAULT NULL COMMENT 'NULL = every user at location_code',
    location_code   VARCHAR(10)  DEFAULT NULL,
    note            VARCHAR(255) DEFAULT NULL,
    status          VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / CANCELLED',
    expires_at      DATETIME     NOT NULL,
    created_by      VARCHAR(100) DEFAULT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_id),
    KEY idx_diag_request_person (person_id, status, expires_at),
    KEY idx_diag_request_location (location_code, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Remote speed test requests';

-- t_client_speedtest.request_id / source (ADD COLUMN IF NOT EXISTS isn't supported here)
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 't_client_speedtest' AND column_name = 'request_id');
SET @s := IF(@c = 0,
    'ALTER TABLE t_client_speedtest ADD COLUMN request_id INT DEFAULT NULL COMMENT ''t_diag_request that triggered an AUTO run'' AFTER speedtest_id',
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 't_client_speedtest' AND column_name = 'source');
SET @s := IF(@c = 0,
    'ALTER TABLE t_client_speedtest ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT ''MANUAL'' COMMENT ''MANUAL / AUTO'' AFTER request_id',
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 't_client_speedtest' AND index_name = 'idx_speedtest_request');
SET @s := IF(@c = 0,
    'ALTER TABLE t_client_speedtest ADD KEY idx_speedtest_request (request_id, person_id, created_at)',
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
