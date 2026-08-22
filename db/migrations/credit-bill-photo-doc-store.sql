-- ============================================================
-- Credit Bill Photo — extend t_document_store for soft-delete/swap
-- Run once on each environment (dev / staging / prod)
-- Safe to re-run: guarded with information_schema checks
-- ============================================================
--
-- Reuses the existing generic t_document_store (entity_type/entity_id/doc_category,
-- see db/migrations/employee-tables.sql) for DSM-captured credit bill photos:
--   entity_type  = 'CREDIT_BILL'
--   entity_id    = t_credits.tcredit_id
--   doc_category = 'BILL_PHOTO'
--
-- New columns support soft-delete (unlink without destroying the row/blob) and
-- swap-with-audit-trail (incorrect photo replaced, old row kept for relinking),
-- generically useful to any future t_document_store consumer, not just bill photos.
--
-- status:
--   ACTIVE   — currently linked to entity_id (default; existing rows stay ACTIVE)
--   UNLINKED — link removed via "delete" in the UI; entity_id/entity_type retained
--              as-is so the row remains searchable for relinking
--   REPLACED — superseded by a newer photo (swap); replaced_by_doc_id points at it
--
-- Size limit: reuses the existing DOC_MAX_UPLOAD_MB location-config key.

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_document_store' AND COLUMN_NAME = 'status'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_document_store
        ADD COLUMN status             VARCHAR(10)  NOT NULL DEFAULT ''ACTIVE'' AFTER file_data,
        ADD COLUMN capture_source     VARCHAR(10)  NULL     AFTER status,
        ADD COLUMN replaced_by_doc_id INT          NULL     AFTER capture_source,
        ADD COLUMN unlinked_by        VARCHAR(45)  NULL     AFTER replaced_by_doc_id,
        ADD COLUMN unlinked_at        DATETIME     NULL     AFTER unlinked_by,
        ADD KEY idx_doc_status (status)',
    'SELECT ''t_document_store already has status column'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_document_store' AND CONSTRAINT_NAME = 'fk_doc_replaced_by'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE t_document_store
        ADD CONSTRAINT fk_doc_replaced_by
            FOREIGN KEY (replaced_by_doc_id) REFERENCES t_document_store (doc_id)
            ON DELETE SET NULL',
    'SELECT ''fk_doc_replaced_by already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
