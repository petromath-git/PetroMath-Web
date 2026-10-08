-- ============================================================
-- Lube Purchase Invoice redesign
--
-- The purchase invoice screen now takes what is printed on the
-- invoice (qty in pieces or litres, gross amount, line discount,
-- cash discount, printed total) and works out per-piece cost, GST
-- and totals itself. All new columns are NULL for existing rows;
-- every reader (GL engine, GST reports, stock valuation, stock
-- ledger) keeps working off the columns it already uses — qty,
-- net_rate, taxable_value, cgst/sgst, amount — which the new screen
-- still fills exactly as before.
--
-- t_lubes_inv_hdr
--   entry_version   2 = saved from the redesigned screen; NULL = legacy
--   tax_type        CGST_SGST | IGST (NULL = legacy, treated as CGST_SGST)
--   discount_mode   LINE | TOTAL (TOTAL = one figure split by value — "estimated")
--   total_line_discount  the single figure typed in TOTAL mode
--   printed_total   "Total" as printed on the paper invoice
--   round_off       printed_total - sum of line amounts (|x| <= 1)
--   (cash_discount already exists — now split across lines BEFORE GST)
--
-- t_lubes_inv_lines
--   entered_qty / entered_uom  what the user typed (PCS | LTR | KG), for audit
--   gross_amount               value before any discount, as printed
--   cash_discount_amount       this line's share of the header cash discount
--   igst_pct / igst_amount     IGST invoices (e.g. HPCL Bengaluru warehouse)
--
-- m_product.pack_volume   litres (or kg) per piece, learned the first time a
--                         user enters litres for a product whose name doesn't
--                         say its pack size. Never needs manual maintenance.
-- m_supplier.invoice_format  IOCL | BPCL | HPCL | GENERIC — which help panel to
--                         show; NULL = the location's oil company.
--
-- Idempotent (information_schema guard; ADD COLUMN IF NOT EXISTS isn't
-- supported on this MySQL).
-- ============================================================

DROP PROCEDURE IF EXISTS tmp_add_col;
DELIMITER $$
CREATE PROCEDURE tmp_add_col(IN p_table VARCHAR(64), IN p_col VARCHAR(64), IN p_def VARCHAR(500))
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_col) THEN
        SET @ddl = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_col, ' ', p_def);
        PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL tmp_add_col('t_lubes_inv_hdr', 'entry_version',       'TINYINT NULL AFTER closing_status');
CALL tmp_add_col('t_lubes_inv_hdr', 'tax_type',            'VARCHAR(10) NULL AFTER entry_version');
CALL tmp_add_col('t_lubes_inv_hdr', 'discount_mode',       'VARCHAR(10) NULL AFTER tax_type');
CALL tmp_add_col('t_lubes_inv_hdr', 'total_line_discount', 'DECIMAL(15,2) NULL AFTER discount_mode');
CALL tmp_add_col('t_lubes_inv_hdr', 'printed_total',       'DECIMAL(15,2) NULL AFTER total_line_discount');
CALL tmp_add_col('t_lubes_inv_hdr', 'round_off',           'DECIMAL(8,2) NULL AFTER printed_total');

CALL tmp_add_col('t_lubes_inv_lines', 'entered_qty',          'DECIMAL(15,3) NULL AFTER qty');
CALL tmp_add_col('t_lubes_inv_lines', 'entered_uom',          'VARCHAR(5) NULL AFTER entered_qty');
CALL tmp_add_col('t_lubes_inv_lines', 'gross_amount',         'DECIMAL(15,2) NULL AFTER net_rate');
CALL tmp_add_col('t_lubes_inv_lines', 'cash_discount_amount', 'DECIMAL(12,2) NULL AFTER discount_amount');
CALL tmp_add_col('t_lubes_inv_lines', 'igst_pct',             'DECIMAL(5,2) NULL AFTER sgst_amount');
CALL tmp_add_col('t_lubes_inv_lines', 'igst_amount',          'DECIMAL(12,2) NULL AFTER igst_pct');

CALL tmp_add_col('m_product',  'pack_volume',    'DECIMAL(10,3) NULL');
CALL tmp_add_col('m_supplier', 'invoice_format', 'VARCHAR(10) NULL');

DROP PROCEDURE IF EXISTS tmp_add_col;

-- Input IGST ledger mapping type for the GL engine (IGST purchase invoices).
-- Mapped per product at /products/ledger-map like Input CGST/SGST.
INSERT INTO m_lookup (lookup_type, description, tag, attribute1, created_by)
SELECT 'ProductMapType', 'Input IGST', 'INPUT_IGST', 'tax', 'SYSTEM'
WHERE NOT EXISTS (SELECT 1 FROM m_lookup WHERE lookup_type = 'ProductMapType' AND tag = 'INPUT_IGST');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 't_lubes_inv_hdr'   AND COLUMN_NAME IN ('entry_version','tax_type','discount_mode','total_line_discount','printed_total','round_off'))
    OR (TABLE_NAME = 't_lubes_inv_lines' AND COLUMN_NAME IN ('entered_qty','entered_uom','gross_amount','cash_discount_amount','igst_pct','igst_amount'))
    OR (TABLE_NAME = 'm_product'         AND COLUMN_NAME = 'pack_volume')
    OR (TABLE_NAME = 'm_supplier'        AND COLUMN_NAME = 'invoice_format'))
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT lookup_id, description, tag FROM m_lookup WHERE lookup_type = 'ProductMapType' ORDER BY lookup_id;
