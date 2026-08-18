-- ============================================================
-- Stock-adjusted COGS: FY opening balance seed table
-- Generated: 2026-08-18
--
-- Holds the ONE persisted number this feature needs per (location, product,
-- financial year): the opening stock quantity + value at FY start. Everything
-- else (COGS for any date range inside the FY, closing balance at any point)
-- is computed on the fly by services/stock-valuation-service.js, replaying
-- purchases and sales chronologically from this opening balance forward.
--
-- source='SEED' = manually estimated because no prior-FY closing balance
-- exists yet (first year a location's stock is tracked this way).
-- source='FY_CLOSE' = will be written once, permanently, when a FY is
-- closed — the computed closing balance becomes the next FY's opening row.
-- Until a FY is closed, nothing here changes; mid-FY, everything replays
-- on the fly from this starting point.
-- ============================================================

CREATE TABLE IF NOT EXISTS gl_stock_opening_balance (
    id              INT NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50) NOT NULL,
    product_id      INT NOT NULL,
    fy_id           INT NOT NULL,
    opening_qty     DECIMAL(15,3) NOT NULL,
    opening_value   DECIMAL(15,2) NOT NULL,
    source          ENUM('SEED', 'FY_CLOSE') NOT NULL DEFAULT 'SEED',
    notes           VARCHAR(255) DEFAULT NULL,
    created_by      VARCHAR(45) DEFAULT NULL,
    creation_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_stock_opening (location_code, product_id, fy_id),
    KEY fk_stock_opening_product (product_id),
    CONSTRAINT fk_stock_opening_fy FOREIGN KEY (fy_id) REFERENCES gl_financial_years (fy_id),
    CONSTRAINT fk_stock_opening_product FOREIGN KEY (product_id) REFERENCES m_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
