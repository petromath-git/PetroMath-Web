-- Migration: Add bay_number column to t_tank_invoice
-- Captures the Bay No. field from BPCL fuel invoices (e.g. "1352 / 4")

ALTER TABLE t_tank_invoice
    ADD COLUMN bay_number VARCHAR(20) NULL AFTER seal_lock_no;
