-- Migration: Add user_remark column to t_bank_transaction
-- Purpose: Allow users to enter optional comments on bank transactions
--          (at time of upload or manual entry), visible in Bank Statement
--          and Oil Company Statement pages.

ALTER TABLE t_bank_transaction
    ADD COLUMN user_remark VARCHAR(500) NULL COMMENT 'Optional user-entered comment on this transaction'
    AFTER remarks;
