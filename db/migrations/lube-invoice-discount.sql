-- Migration: Capture discounts on Lube Invoices
-- Both BPCL and IOCL lube invoices show a two-tier discount: a per-line discount
-- (reducing that line's taxable value) and a separate cash discount applied to the
-- invoice total. Captured as absolute rupee amounts, matching how suppliers present
-- them (not percentages).

ALTER TABLE t_lubes_inv_lines
    ADD COLUMN discount_amount DECIMAL(12,2) NULL DEFAULT 0 AFTER net_rate;

ALTER TABLE t_lubes_inv_hdr
    ADD COLUMN cash_discount DECIMAL(15,2) NULL DEFAULT 0 AFTER invoice_amount;
