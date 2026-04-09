-- ============================================================
-- Bowser Delivery Tables — Split into 3 separate tables
-- Replaces t_bowser_delivery_items (single table with sale_type)
-- ============================================================

-- ── Table 1: t_bowser_credits ─────────────────────────────────
CREATE TABLE IF NOT EXISTS t_bowser_credits (
    credit_id         INT           NOT NULL AUTO_INCREMENT,
    bowser_closing_id INT           NOT NULL,
    creditlist_id     INT           NOT NULL,
    vehicle_id        INT           NULL,
    product_id        INT           NOT NULL,
    quantity          DECIMAL(10,3) NOT NULL DEFAULT 0,
    rate              DECIMAL(10,4) NOT NULL DEFAULT 0,
    amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_by        VARCHAR(45)   NULL,
    creation_date     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (credit_id),
    KEY idx_bc_credits_closing (bowser_closing_id),
    KEY idx_bc_credits_party   (creditlist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: t_bowser_digital_sales ──────────────────────────
-- Mirrors t_digital_sales: amount-only entry + full recon columns
CREATE TABLE IF NOT EXISTS t_bowser_digital_sales (
    digital_id          INT           NOT NULL AUTO_INCREMENT,
    bowser_closing_id   INT           NOT NULL,
    digital_vendor_id   INT           NOT NULL COMMENT 'FK to m_credit_list where card_flag=Y',
    amount              DECIMAL(12,2) NOT NULL DEFAULT 0,
    digital_ref         VARCHAR(100)  NULL     COMMENT 'UPI/card ref',
    recon_match_id      BIGINT        NULL,
    manual_recon_flag   TINYINT(1)    NOT NULL DEFAULT 0,
    manual_recon_by     VARCHAR(50)   NULL,
    manual_recon_date   DATETIME      NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (digital_id),
    KEY idx_bc_digi_closing (bowser_closing_id),
    KEY idx_bc_digi_vendor  (digital_vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_bowser_cashsales ───────────────────────────────
CREATE TABLE IF NOT EXISTS t_bowser_cashsales (
    cashsale_id       INT           NOT NULL AUTO_INCREMENT,
    bowser_closing_id INT           NOT NULL,
    product_id        INT           NOT NULL,
    amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_by        VARCHAR(45)   NULL,
    creation_date     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cashsale_id),
    KEY idx_bc_cash_closing (bowser_closing_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Migrate existing data from t_bowser_delivery_items ────────
INSERT IGNORE INTO t_bowser_credits
    (bowser_closing_id, creditlist_id, vehicle_id, product_id, quantity, rate, amount, created_by, creation_date)
SELECT bowser_closing_id, creditlist_id, vehicle_id, product_id, quantity, rate, amount, created_by, creation_date
FROM t_bowser_delivery_items
WHERE sale_type = 'CREDIT';

INSERT IGNORE INTO t_bowser_digital_sales
    (bowser_closing_id, digital_vendor_id, amount, digital_ref, created_by, creation_date)
SELECT bowser_closing_id, COALESCE(digital_vendor_id, creditlist_id), amount, digital_ref, created_by, creation_date
FROM t_bowser_delivery_items
WHERE sale_type = 'DIGITAL';

INSERT IGNORE INTO t_bowser_cashsales
    (bowser_closing_id, product_id, amount, created_by, creation_date)
SELECT bowser_closing_id, product_id, amount, created_by, creation_date
FROM t_bowser_delivery_items
WHERE sale_type = 'CASH';

-- ── Drop old unified table ────────────────────────────────────
DROP TABLE IF EXISTS t_bowser_delivery_items;

SELECT 'Bowser delivery tables split complete.' AS status;
