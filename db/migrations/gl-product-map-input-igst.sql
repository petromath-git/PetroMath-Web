-- Product ledger map: allow INPUT_IGST.
--
-- lube-invoice-redesign.sql added the 'Input IGST' map type (m_lookup ProductMapType,
-- tag INPUT_IGST) and create-accounting-service posts IGST purchase lines through
-- resolveProductLedger(..., 'INPUT_IGST'), but gl_product_ledger_map.map_type is an
-- ENUM without that value. With a non-strict sql_mode MySQL stores '' instead, so
-- every Input IGST mapping saved from /products/ledger-map became map_type = ''
-- (and "Copy to" spread it to other products), and IGST lube invoices can't find
-- their ledger.
--
-- 1. add INPUT_IGST to the enum on the map and its history table;
-- 2. turn the '' rows that point at an IGST ledger back into INPUT_IGST.
-- Idempotent: re-running changes nothing.

ALTER TABLE gl_product_ledger_map
    MODIFY map_type ENUM('SALES','PURCHASE','INPUT_CGST','INPUT_SGST','OUTPUT_CGST','OUTPUT_SGST',
                         'INPUT_VAT','OUTPUT_VAT','STOCK','INPUT_IGST') NOT NULL;

ALTER TABLE gl_product_ledger_map_h
    MODIFY map_type ENUM('SALES','PURCHASE','INPUT_CGST','INPUT_SGST','OUTPUT_CGST','OUTPUT_SGST',
                         'INPUT_VAT','OUTPUT_VAT','STOCK','INPUT_IGST') NOT NULL;

UPDATE gl_product_ledger_map m
JOIN gl_ledgers l ON l.ledger_id = m.ledger_id
SET m.map_type = 'INPUT_IGST'
WHERE m.map_type = ''
  AND UPPER(l.ledger_name) LIKE '%IGST%';   -- the unique key allows one '' row per product, so no clash

-- Anything still '' is not an IGST row: list it for a manual look.
SELECT m.map_id, m.location_code, m.product_id, l.ledger_name
FROM gl_product_ledger_map m JOIN gl_ledgers l ON l.ledger_id = m.ledger_id
WHERE m.map_type = '';
