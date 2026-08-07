-- Backfill: populate GST breakdown on existing t_lubes_inv_lines rows using each
-- product's CURRENT m_product rate. This is a best-effort backfill -- there is no
-- record of what the GST rate actually was at the time of these older invoices, so
-- this assumes today's product-master rate held at invoice time too.
--
-- Uses the same tax-inclusive interpretation of `amount` that the manual-entry form
-- now captures going forward (Taxable Value + GST Amount = amount), so backfilled
-- rows are consistent with newly-captured ones rather than introducing a third
-- formula. Run once; safe to re-run (only touches rows where taxable_value IS NULL).

UPDATE t_lubes_inv_lines l
JOIN m_product p ON p.product_id = l.product_id
SET
    l.taxable_value = ROUND(l.amount / (1 + (COALESCE(p.cgst_percent,0) + COALESCE(p.sgst_percent,0)) / 100), 2),
    l.cgst_pct      = COALESCE(p.cgst_percent, 0),
    l.cgst_amount   = ROUND(l.amount / (1 + (COALESCE(p.cgst_percent,0) + COALESCE(p.sgst_percent,0)) / 100) * COALESCE(p.cgst_percent,0) / 100, 2),
    l.sgst_pct      = COALESCE(p.sgst_percent, 0),
    l.sgst_amount   = ROUND(l.amount / (1 + (COALESCE(p.cgst_percent,0) + COALESCE(p.sgst_percent,0)) / 100) * COALESCE(p.sgst_percent,0) / 100, 2)
WHERE l.taxable_value IS NULL
  AND l.amount > 0;
