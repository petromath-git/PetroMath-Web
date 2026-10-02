-- ============================================================
-- Platform billing: run log
--
-- One row per invoice-generation run — the 3rd-of-month schedule, the
-- catch-up run at app start, and manual runs from the Generate dialog.
-- Shown on /platform-billing/runs.
--
-- status:
--   RUNNING   — started, not finished yet (stays RUNNING if the app died mid-run)
--   SUCCESS   — finished, no errors
--   PARTIAL   — finished, but some locations failed with an error
--   FAILED    — the run itself failed
--   SKIPPED   — another run already held the billing lock, nothing done
--
-- log_json: { generated: [invoice_number...], skipped: [{location_code, reason}...] }
--
-- Safe to re-run (CREATE TABLE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS t_platform_billing_run (
    run_id          INT AUTO_INCREMENT PRIMARY KEY,
    trigger_type    VARCHAR(20)  NOT NULL,              -- SCHEDULED / STARTUP / MANUAL
    requested_by    VARCHAR(45)  NOT NULL,
    run_mode        VARCHAR(10)  NOT NULL,              -- DUE / MONTH
    period_start    DATE         NULL,                  -- MONTH mode only
    location_code   VARCHAR(50)  NULL,                  -- NULL = all locations
    status          VARCHAR(10)  NOT NULL DEFAULT 'RUNNING',
    started_at      DATETIME     NOT NULL,
    finished_at     DATETIME     NULL,
    generated_count INT          NOT NULL DEFAULT 0,
    skipped_count   INT          NOT NULL DEFAULT 0,
    error_count     INT          NOT NULL DEFAULT 0,
    log_json        MEDIUMTEXT   NULL,
    error_message   VARCHAR(1000) NULL,
    instance_name   VARCHAR(150) NULL,                  -- host:app-folder that ran it
    INDEX idx_pbr_started (started_at)
);

-- ── Verify ───────────────────────────────────────────────────────────
SHOW COLUMNS FROM t_platform_billing_run;
