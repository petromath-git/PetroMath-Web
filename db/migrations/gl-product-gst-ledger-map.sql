-- ============================================================
-- GL Product GST Ledger Map
-- Generated: 2026-05-01
--
-- Seeds OUTPUT_CGST and OUTPUT_SGST rows in gl_product_ledger_map
-- for every product that has cgst_percent > 0 and already has
-- a SALES mapping, pointing to the OUTPUT CGST / OUTPUT SGST
-- ledgers under Duties & Taxes for that location.
--
-- Safe to re-run: INSERT IGNORE skips duplicates.
-- ============================================================

-- ── OUTPUT_CGST mappings ──────────────────────────────────────────────────────

INSERT IGNORE INTO gl_product_ledger_map (location_code, product_id, map_type, ledger_id)
SELECT
    plm.location_code,
    plm.product_id,
    'OUTPUT_CGST',
    gst_l.ledger_id
FROM gl_product_ledger_map plm
JOIN m_product mp ON mp.product_id = plm.product_id
JOIN gl_ledgers gst_l ON gst_l.location_code = plm.location_code
                      AND gst_l.ledger_name   = 'OUTPUT CGST'
JOIN gl_ledger_groups g ON g.group_id = gst_l.group_id
                        AND g.group_name = 'Duties & Taxes'
WHERE plm.map_type      = 'SALES'
  AND mp.cgst_percent   > 0;

-- ── OUTPUT_SGST mappings ──────────────────────────────────────────────────────

INSERT IGNORE INTO gl_product_ledger_map (location_code, product_id, map_type, ledger_id)
SELECT
    plm.location_code,
    plm.product_id,
    'OUTPUT_SGST',
    gst_l.ledger_id
FROM gl_product_ledger_map plm
JOIN m_product mp ON mp.product_id = plm.product_id
JOIN gl_ledgers gst_l ON gst_l.location_code = plm.location_code
                      AND gst_l.ledger_name   = 'OUTPUT SGST'
JOIN gl_ledger_groups g ON g.group_id = gst_l.group_id
                        AND g.group_name = 'Duties & Taxes'
WHERE plm.map_type      = 'SALES'
  AND mp.cgst_percent   > 0;

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT map_type, COUNT(*) AS rows_inserted
FROM gl_product_ledger_map
WHERE map_type IN ('OUTPUT_CGST', 'OUTPUT_SGST')
GROUP BY map_type;

-- Spot check: products with SALES but missing OUTPUT_CGST (should be 0 or only cgst=0 products)
SELECT plm.location_code, plm.product_id, mp.product_name, mp.cgst_percent
FROM gl_product_ledger_map plm
JOIN m_product mp ON mp.product_id = plm.product_id
WHERE plm.map_type    = 'SALES'
  AND mp.cgst_percent > 0
  AND NOT EXISTS (
      SELECT 1 FROM gl_product_ledger_map plm2
      WHERE plm2.location_code = plm.location_code
        AND plm2.product_id    = plm.product_id
        AND plm2.map_type      = 'OUTPUT_CGST'
  )
ORDER BY plm.location_code, mp.product_name;
