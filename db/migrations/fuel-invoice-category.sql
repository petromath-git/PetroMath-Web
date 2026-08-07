-- Migration: Add fuel_category column to t_tank_invoice
-- Distinguishes CNG invoices from regular fuel (MS/HSD) invoices so the
-- purchase invoice search screen can filter within type=FUEL.
-- Populated at save time (see purchases-controller.js saveFuelInvoice); backfill
-- below classifies existing rows from their line items' qty_unit
-- (CNG is invoiced in KG, MS/HSD in KL).

ALTER TABLE t_tank_invoice
    ADD COLUMN fuel_category VARCHAR(10) NULL AFTER bay_number;

UPDATE t_tank_invoice ti
SET fuel_category = CASE
    WHEN EXISTS (
        SELECT 1 FROM t_tank_invoice_dtl d
        WHERE d.invoice_id = ti.id AND d.qty_unit = 'KG'
    ) THEN 'CNG'
    ELSE 'MS_HSD'
END
WHERE fuel_category IS NULL;
