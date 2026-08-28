-- ============================================================
-- Employee Advance tab in Shift Closing: schema groundwork
--
-- Adds closing_id to t_employee_ledger so an ADVANCE/PAYMENT/
-- ADVANCE_RECOVERY entry made from the shift-closing "Employee
-- Advance" tab can be tied back to the shift that recorded it.
-- Nullable: rows created via the admin /employees/:id ledger
-- modal are unaffected and keep closing_id = NULL.
--
-- Mirrors add-closing-id-to-receipts.sql exactly (same shape:
-- plain nullable INT + index, no enforced FK - deleting a
-- t_closing row does not cascade here either).
--
-- NOT safe to re-run: this server rejects ADD COLUMN/INDEX IF NOT
-- EXISTS (works only on MySQL 8.0.29+ server-side; this server
-- doesn't support it despite an 8.4 client). Re-running errors with
-- "Duplicate column/key" rather than silently no-op'ing.
-- ============================================================

ALTER TABLE t_employee_ledger
    ADD COLUMN closing_id INT NULL
        COMMENT 'FK to t_closing.closing_id; NULL for entries made outside a shift (admin Employee ledger modal).',
    ADD INDEX idx_employee_ledger_closing_id (closing_id);
