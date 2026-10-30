-- ============================================================================
-- Support Tickets: Claude conversation links
--
-- t_dev_tracker.claude_links: the Claude conversations that worked on a ticket,
-- one per line. Each line is an https:// link or a Claude Code session id
-- (resumed with `claude --resume <id>`). Shown and editable for SuperUser only.
--
-- Safe to re-run.
-- ============================================================================

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'claude_links'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_dev_tracker ADD COLUMN claude_links TEXT NULL AFTER tags',
    'SELECT ''claude_links column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check
SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'claude_links';
