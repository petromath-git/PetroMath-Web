-- ============================================================================
-- Tank Truck Freight, phase 2: XTRAPOWER fleet card statements (/tt?tab=card)
-- Run after tt-freight.sql.
--
-- IOCL pays part of the freight onto the truck's XTRAPOWER card ("Recharge",
-- Sankari Depot). The truck buys diesel with it ("Sale") and earns loyalty
-- points (0.40% of sales, 100 points = Rs 1), on which IOCL posts TDS. Points
-- can be turned into card money (a CCMS recharge from IOCL HO - LOYALTY).
--
-- 1. m_tt_fleet_card       — the card account (XTRAPOWER customer id) and its ledgers.
-- 2. t_tt_card_statement   — one row per uploaded monthly statement (summary lines).
--    t_tt_card_txn         — one row per statement transaction.
-- 3. Ledgers at MC and MME: XTRAPOWER CARD - <customer id> and XTRAPOWER LOYALTY
--    POINTS (Current Assets), TANK TRUCK DIESEL (next to TANK TRUCK EXPENSES),
--    XTRAPOWER LOYALTY INCOME (Indirect Incomes).
--
-- GL (event TT_CARD_STATEMENT, one per statement):
--   Recharge         card Dr / oil company TT debtor Cr     (the card part of the freight)
--   Sale             TANK TRUCK DIESEL Dr / card Cr
--   Loyalty (month)  points Dr / loyalty income Cr; TDS RECEIVABLE Dr / points Cr
--   Points to card   card Dr / points Cr
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_tt_fleet_card (
    card_id                  INT           NOT NULL AUTO_INCREMENT,
    location_code            VARCHAR(50)   NOT NULL,
    customer_id              VARCHAR(20)   NOT NULL COMMENT 'XTRAPOWER customer id on the statement',
    customer_name            VARCHAR(200)  NULL,
    vendor_id                INT           NULL COMMENT 'm_tt_vendor whose debtor the recharges clear',
    vehicle_id               INT           NULL,
    wallet_ledger_id         INT           NULL,
    points_ledger_id         INT           NULL,
    diesel_ledger_id         INT           NULL,
    loyalty_income_ledger_id INT           NULL,
    tds_ledger_id            INT           NULL,
    points_per_rupee         INT           NOT NULL DEFAULT 100,
    start_date               DATE          NOT NULL COMMENT 'statements for periods before this are not taken',
    active_flag              CHAR(1)       NOT NULL DEFAULT 'Y',
    created_by               VARCHAR(45)   NULL,
    updated_by               VARCHAR(45)   NULL,
    creation_date            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (card_id),
    UNIQUE KEY uniq_tt_fleet_card (location_code, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_tt_card_statement (
    statement_id        INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    card_id             INT           NOT NULL,
    period_from         DATE          NOT NULL,
    period_to           DATE          NOT NULL,
    ccms_opening        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ccms_recharge       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ccms_sale           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ccms_closing        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pts_opening         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_award           DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_redemption      DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_withheld        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_tds             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_expiry          DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    pts_closing         DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    file_name           VARCHAR(200)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (statement_id),
    UNIQUE KEY uniq_tt_card_period (card_id, period_from),
    KEY idx_tt_card_stmt_loc (location_code, period_from),
    CONSTRAINT fk_tt_card_stmt_card FOREIGN KEY (card_id) REFERENCES m_tt_fleet_card (card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- kind: RECHARGE, SALE, SALE_COMPLETE, REVERSAL, POINTS_TO_CARD (rupees);
--       LOYALTY_AWARD, LOYALTY_TDS, LOYALTY_REDEEM, LOYALTY_EXPIRY, LOYALTY_OTHER (points); OTHER
-- rupees = amount for card rows, points / points_per_rupee for loyalty rows
CREATE TABLE IF NOT EXISTS t_tt_card_txn (
    txn_id              INT           NOT NULL AUTO_INCREMENT,
    statement_id        INT           NOT NULL,
    sno                 INT           NOT NULL,
    kind                VARCHAR(20)   NOT NULL,
    txn_type            VARCHAR(50)   NULL,
    txn_ref             VARCHAR(30)   NULL,
    txn_date            DATE          NULL,
    txn_time            DATETIME      NULL,
    settle_date         DATE          NULL,
    merchant            VARCHAR(100)  NULL,
    merchant_pan        VARCHAR(15)   NULL,
    location            VARCHAR(100)  NULL,
    card_no             VARCHAR(25)   NULL,
    vehicle_no          VARCHAR(20)   NULL,
    product             VARCHAR(100)  NULL,
    currency            VARCHAR(20)   NULL,
    amount              DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    balance             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    rupees              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status              VARCHAR(10)   NULL,
    PRIMARY KEY (txn_id),
    KEY idx_tt_card_txn_stmt (statement_id),
    KEY idx_tt_card_txn_kind (kind, txn_date),
    CONSTRAINT fk_tt_card_txn_stmt FOREIGN KEY (statement_id) REFERENCES t_tt_card_statement (statement_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Cards ---------------------------------------------------------------------
INSERT INTO m_tt_fleet_card (location_code, customer_id, customer_name, vendor_id, vehicle_id, tds_ledger_id, start_date, created_by, updated_by)
SELECT c.location_code, c.customer_id, c.customer_name,
       (SELECT vendor_id FROM m_tt_vendor WHERE location_code = c.location_code AND oil_company = 'IOCL' LIMIT 1),
       (SELECT vehicle_id FROM m_tt_vehicle WHERE location_code = c.location_code AND vehicle_no = c.vehicle_no LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = 'TDS RECEIVABLE' LIMIT 1),
       '2026-04-01', 'system', 'system'
FROM (SELECT 'MC' AS location_code, '1000909010' AS customer_id, 'AR CHINNA NACHI MUTHU' AS customer_name, 'TN39BY1899' AS vehicle_no
      UNION ALL SELECT 'MME', '1001576792', NULL, 'TN39BV2599') c
WHERE EXISTS (SELECT 1 FROM m_location l WHERE l.location_code = c.location_code)
  AND NOT EXISTS (SELECT 1 FROM m_tt_fleet_card x WHERE x.location_code = c.location_code AND x.customer_id = c.customer_id);

UPDATE m_tt_vehicle h JOIN m_tt_fleet_card c ON c.location_code = h.location_code AND c.vehicle_id = h.vehicle_id
SET h.fleet_card_id = c.customer_id
WHERE h.fleet_card_id IS NULL;

-- Ledgers -------------------------------------------------------------------
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT c.location_code, CONCAT('XTRAPOWER CARD - ', c.customer_id), g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
JOIN gl_ledger_groups g ON g.location_code = c.location_code AND g.group_name = 'Current Assets'
WHERE NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = CONCAT('XTRAPOWER CARD - ', c.customer_id));

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT c.location_code, 'XTRAPOWER LOYALTY POINTS', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
JOIN gl_ledger_groups g ON g.location_code = c.location_code AND g.group_name = 'Current Assets'
WHERE NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = 'XTRAPOWER LOYALTY POINTS');

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT c.location_code, 'XTRAPOWER LOYALTY INCOME', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
JOIN gl_ledger_groups g ON g.location_code = c.location_code AND g.group_name = 'Indirect Incomes'
WHERE NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = 'XTRAPOWER LOYALTY INCOME');

-- Diesel goes in the same group as the existing TANK TRUCK EXPENSES ledger (else Indirect Expenses)
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT c.location_code, 'TANK TRUCK DIESEL',
       COALESCE((SELECT e.group_id FROM gl_ledgers e WHERE e.location_code = c.location_code AND e.ledger_name = 'TANK TRUCK EXPENSES' LIMIT 1),
                (SELECT g.group_id FROM gl_ledger_groups g WHERE g.location_code = c.location_code AND g.group_name = 'Indirect Expenses' LIMIT 1)),
       'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
WHERE NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = 'TANK TRUCK DIESEL');

UPDATE m_tt_fleet_card c
SET c.wallet_ledger_id = COALESCE(c.wallet_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = CONCAT('XTRAPOWER CARD - ', c.customer_id) LIMIT 1)),
    c.points_ledger_id = COALESCE(c.points_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = 'XTRAPOWER LOYALTY POINTS' LIMIT 1)),
    c.loyalty_income_ledger_id = COALESCE(c.loyalty_income_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = 'XTRAPOWER LOYALTY INCOME' LIMIT 1)),
    c.diesel_ledger_id = COALESCE(c.diesel_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = 'TANK TRUCK DIESEL' LIMIT 1)),
    c.updated_by = 'system';

-- Verify
SELECT c.location_code, c.customer_id, c.vendor_id, c.vehicle_id, c.wallet_ledger_id, c.points_ledger_id,
       c.diesel_ledger_id, c.loyalty_income_ledger_id, c.tds_ledger_id, c.start_date
FROM m_tt_fleet_card c ORDER BY c.location_code;
