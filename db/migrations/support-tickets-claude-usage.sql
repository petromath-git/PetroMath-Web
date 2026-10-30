-- ============================================================================
-- Support Tickets: Claude usage
--
-- t_dev_tracker.claude_tokens   total tokens of the Claude conversations that
--                               worked on the ticket (input + output + cache)
-- t_dev_tracker.claude_cost_usd the same at Anthropic API list prices (what it
--                               would cost on the API, not the subscription bill)
-- Filled from the Claude Code transcripts when work is logged. SuperUser only.
--
-- Safe to re-run.
-- ============================================================================

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'claude_tokens'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_dev_tracker ADD COLUMN claude_tokens BIGINT NULL AFTER claude_links, ADD COLUMN claude_cost_usd DECIMAL(10,2) NULL AFTER claude_tokens',
    'SELECT ''claude usage columns already exist'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Check
SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME IN ('claude_tokens', 'claude_cost_usd');
