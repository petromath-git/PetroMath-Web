-- ============================================================================
-- IOCL e-Mitra pull safeguards: one row per portal login attempt.
-- The app derives its limits from this log (per account):
--   * only one attempt RUNNING at a time
--   * pulls at least 2 minutes apart
--   * max 5 portal logins per day (pulls + "Check & Save")
--   * pulls blocked after 2 consecutive LOGIN_FAILED until a successful login
-- Also serves as the audit trail of who pulled what, when.
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_oil_portal_login_attempt (
    attempt_id     BIGINT       NOT NULL AUTO_INCREMENT,
    bank_id        INT          NOT NULL,
    location_code  VARCHAR(50)  NOT NULL,
    purpose        VARCHAR(10)  NOT NULL COMMENT 'PULL / SAVE',
    from_date      DATE         NULL,
    to_date        DATE         NULL,
    result         VARCHAR(20)  NOT NULL DEFAULT 'RUNNING' COMMENT 'RUNNING / OK / LOGIN_FAILED / ERROR',
    message        VARCHAR(500) NULL,
    started_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at    DATETIME     NULL,
    created_by     VARCHAR(45)  NULL,
    PRIMARY KEY (attempt_id),
    KEY idx_oil_portal_attempt_bank (bank_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
