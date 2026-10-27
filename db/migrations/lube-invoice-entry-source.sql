-- Migration: remember how a lube purchase invoice was entered.
-- 'PDF' = filled from the supplier's invoice PDF; its figures stay locked on
-- the screen (only the product pick and MRP can change). NULL = typed by hand.

ALTER TABLE t_lubes_inv_hdr
    ADD COLUMN entry_source VARCHAR(10) NULL AFTER round_off;
