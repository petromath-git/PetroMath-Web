-- ============================================================
-- GL Accounting: correction queue for mapping changes
-- Generated: 2026-08-16
--
-- When a ledger mapping changes AFTER accounting entries were already
-- posted against the old value, this logs exactly which vouchers are now
-- stale — instead of silently leaving them wrong, or requiring a blind
-- whole-date-range reprocess (which reverses+reposts everything in the
-- range, not just what the mapping change actually affects).
--
-- Populated by AFTER UPDATE/DELETE triggers on gl_product_ledger_map and
-- gl_static_ledger_map (see gl-correction-queue-triggers.sql) — DB-level,
-- not application code, so it catches every change regardless of source
-- (UI, raw SQL, future migrations). mapping_source is a free string so
-- this extends to other mapping tables later without a schema change.
-- creation_date uses microsecond precision so the app can identify exactly
-- which rows a specific save just inserted (compare against a NOW(6)
-- captured immediately before the write).
-- ============================================================

CREATE TABLE IF NOT EXISTS gl_correction_queue (
    queue_id        INT NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50)  NOT NULL,
    mapping_source  VARCHAR(50)  NOT NULL COMMENT 'e.g. STATIC_LEDGER_MAP, PRODUCT_LEDGER_MAP',
    mapping_key     VARCHAR(250) NOT NULL COMMENT 'e.g. the ledger_name, or product_id:map_type, that changed',
    old_description VARCHAR(255) NULL,
    new_description VARCHAR(255) NULL,
    source_type     VARCHAR(50)  NOT NULL,
    source_id       INT          NOT NULL,
    voucher_id      INT NULL,
    fy_id           INT NULL,
    status          ENUM('PENDING', 'REPROCESSED', 'IGNORED') NOT NULL DEFAULT 'PENDING',
    created_by      VARCHAR(45),
    creation_date   TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    resolved_by     VARCHAR(45) NULL,
    resolved_date   TIMESTAMP NULL,
    PRIMARY KEY (queue_id),
    KEY idx_gl_correction_queue_status (location_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
