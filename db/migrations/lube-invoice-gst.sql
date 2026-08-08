-- Migration: Capture GST breakdown on Lube Invoice lines
-- Both BPCL and IOCL lube invoices show: Rate x Qty - Discount = Taxable Value,
-- then GST% applied on top = GST Amount, giving Net Amount (Taxable Value + GST Amount).
-- Previously the app had no GST fields on t_lubes_inv_lines, so the GL accounting
-- engine (services/create-accounting-service.js) and the purchase GST report
-- (dao/gst-data-aggregation-dao.js) both had to reverse-calculate the split from
-- whatever m_product's CURRENT cgst_percent/sgst_percent happens to be -- which
-- silently drifts if the product's rate changes after the invoice was entered.
--
-- These columns let the invoice line capture the rate that was actually charged,
-- as a permanent point-in-time record. NULL for existing rows -- both consumers
-- fall back to the product-master calculation they already use when these are NULL,
-- so historical data keeps working unchanged.

ALTER TABLE t_lubes_inv_lines
    ADD COLUMN taxable_value DECIMAL(12,2) NULL AFTER discount_amount,
    ADD COLUMN cgst_pct      DECIMAL(5,2)  NULL AFTER taxable_value,
    ADD COLUMN cgst_amount   DECIMAL(12,2) NULL AFTER cgst_pct,
    ADD COLUMN sgst_pct      DECIMAL(5,2)  NULL AFTER cgst_amount,
    ADD COLUMN sgst_amount   DECIMAL(12,2) NULL AFTER sgst_pct;
