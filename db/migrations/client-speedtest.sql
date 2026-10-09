-- Client speed test results (/speedtest).
-- A user who reports slowness opens /speedtest, runs the test and reads out the
-- result code (= speedtest_id) so support can look it up at /speedtest/results.
-- Additive only; safe to run on prod ahead of the code (beta DB is restored from
-- prod every 4h, so the table must exist on prod for beta to keep it).

CREATE TABLE IF NOT EXISTS t_client_speedtest (
    speedtest_id       INT          NOT NULL AUTO_INCREMENT,
    person_id          INT          DEFAULT NULL,
    user_name          VARCHAR(100) DEFAULT NULL,
    location_code      VARCHAR(10)  DEFAULT NULL,
    ip_address         VARCHAR(64)  DEFAULT NULL,
    user_agent         VARCHAR(500) DEFAULT NULL,
    ping_avg_ms        INT          DEFAULT NULL COMMENT 'Round trip incl. server time',
    ping_min_ms        INT          DEFAULT NULL,
    jitter_ms          INT          DEFAULT NULL,
    server_avg_ms      DECIMAL(8,1) DEFAULT NULL COMMENT 'Server-Timing app;dur — server share of the round trip',
    download_mbps      DECIMAL(8,2) DEFAULT NULL,
    upload_mbps        DECIMAL(8,2) DEFAULT NULL,
    failed_pings       INT          DEFAULT NULL,
    connection_type    VARCHAR(20)  DEFAULT NULL COMMENT 'navigator.connection.effectiveType (Chrome/Android only)',
    verdict            VARCHAR(20)  DEFAULT NULL COMMENT 'GOOD / FAIR / POOR',
    details_json       JSON         DEFAULT NULL COMMENT 'Raw samples, device info, page timings',
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (speedtest_id),
    KEY idx_speedtest_location_created (location_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Client network speed test results';
