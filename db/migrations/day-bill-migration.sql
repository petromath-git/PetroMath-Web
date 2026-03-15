-- ============================================================
-- Day Bill Migration
-- Run once on each environment (dev / staging / prod)
-- Safe to re-run: uses IF NOT EXISTS throughout
-- ============================================================

-- ── Table 1: t_day_bill ──────────────────────────────────────
-- One row per location per calendar day.
-- Auto-created when a shift or cashflow is closed.
CREATE TABLE IF NOT EXISTS t_day_bill (
    day_bill_id    INT          NOT NULL AUTO_INCREMENT,
    location_code  VARCHAR(50)  NOT NULL,
    bill_date      DATE         NOT NULL,
    cashflow_id    INT          NULL,          -- FK to t_cashflow_closing (cashflow-enabled locations)
    status         ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    created_by     VARCHAR(45)  NULL,
    creation_date  DATE         NULL,
    updated_by     VARCHAR(45)  NULL,
    updation_date  DATE         NULL,
    PRIMARY KEY (day_bill_id),
    UNIQUE KEY uq_location_date (location_code, bill_date),
    KEY idx_bill_date (bill_date),
    KEY idx_cashflow_id (cashflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: t_day_bill_header ───────────────────────────────
-- One row per bill within a day:
--   • CASH  : one row, vendor_id = NULL
--   • DIGITAL: one row per digital vendor
CREATE TABLE IF NOT EXISTS t_day_bill_header (
    header_id      INT           NOT NULL AUTO_INCREMENT,
    day_bill_id    INT           NOT NULL,
    bill_type      ENUM('CASH','DIGITAL') NOT NULL,
    vendor_id      INT           NULL,         -- NULL for CASH; FK to m_credit_list for DIGITAL
    bill_number    VARCHAR(100)  NULL,         -- entered by manager from physical bill book
    total_amount   DECIMAL(15,3) NOT NULL DEFAULT 0,
    created_by     VARCHAR(45)   NULL,
    creation_date  DATE          NULL,
    updated_by     VARCHAR(45)   NULL,
    updation_date  DATE          NULL,
    PRIMARY KEY (header_id),
    KEY idx_day_bill_id (day_bill_id),
    KEY idx_vendor_id (vendor_id),
    CONSTRAINT fk_dbh_day_bill
        FOREIGN KEY (day_bill_id) REFERENCES t_day_bill (day_bill_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_day_bill_items ────────────────────────────────
-- Itemised lines — one row per product per header.
CREATE TABLE IF NOT EXISTS t_day_bill_items (
    item_id        INT           NOT NULL AUTO_INCREMENT,
    header_id      INT           NOT NULL,
    product_id     INT           NOT NULL,
    quantity       DECIMAL(12,3) NOT NULL DEFAULT 0,
    rate           DECIMAL(10,3) NOT NULL DEFAULT 0,
    taxable_amount DECIMAL(15,3) NOT NULL DEFAULT 0,
    cgst_rate      DECIMAL(5,2)  NOT NULL DEFAULT 0,
    cgst_amount    DECIMAL(15,3) NOT NULL DEFAULT 0,
    sgst_rate      DECIMAL(5,2)  NOT NULL DEFAULT 0,
    sgst_amount    DECIMAL(15,3) NOT NULL DEFAULT 0,
    total_amount   DECIMAL(15,3) NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id),
    KEY idx_header_id (header_id),
    KEY idx_product_id (product_id),
    CONSTRAINT fk_dbi_header
        FOREIGN KEY (header_id) REFERENCES t_day_bill_header (header_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'Migration complete' AS status;
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('t_day_bill', 't_day_bill_header', 't_day_bill_items')
ORDER BY TABLE_NAME;
