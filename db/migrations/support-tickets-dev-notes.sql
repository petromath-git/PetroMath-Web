-- ============================================================================
-- Support Tickets: dev notes
--
-- t_dev_tracker.dev_notes: what was found and changed, for whoever picks up the
-- area next (cause, fix, files, DB, PRs, config, how to verify, gotchas,
-- related tickets). Shown, searched and edited for SuperUser only.
--
-- Safe to re-run.
-- ============================================================================

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'dev_notes'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_dev_tracker ADD COLUMN dev_notes TEXT NULL AFTER description',
    'SELECT ''dev_notes column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check
SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'dev_notes';
