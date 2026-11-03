-- ============================================================================
-- Tank Truck Freight (/tt) — Transport module, phase 1
--
-- MC and MME run a tank truck for IOCL. IOCL's SAP raises the freight bill
-- ("Transportation Bill", issued in the dealer's name) every half month. GST on
-- it is under reverse charge (IOCL pays it), IOCL deducts 194C TDS and pays the
-- rest about the 5th of the next month: ~60% to the bank, ~40% to the truck's
-- XtraPower fleet card.
--
-- 1. m_tt_vendor        — the dealer as a transporter of an oil company (vendor
--                          code, SAC, GST rate, TDS %, ledgers, receipt bank).
-- 2. m_tt_vehicle       — the trucks.
-- 3. t_tt_invoice       — one row per freight bill, uploaded from the PDF.
--    t_tt_invoice_line  — one row per trip on the bill.
--    t_tt_invoice_deleted — archive of deleted bills.
-- 4. Ledgers: "IOCL - TT FREIGHT" (Sundry Debtors) at MC and MME, "TDS
--    RECEIVABLE" at MME (MC has it from Rental). Income stays on the existing
--    tank truck rent ledgers.
-- 5. Bank receipt label "TT FREIGHT - IOCL" (credit rule on the receipt bank,
--    mapped to the debtor ledger), so the bank part of IOCL's payment clears the
--    debtor instead of booking income a second time.
-- 6. SAC 996791 (goods transport agency) in m_gst_hsn.
-- 7. Menus, granted to MC and MME: TT_FREIGHT (Transactions), TT_MASTER (Masters).
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_tt_vendor (
    vendor_id           INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    oil_company         VARCHAR(10)   NOT NULL DEFAULT 'IOCL',
    vendor_code         VARCHAR(20)   NOT NULL COMMENT 'transporter vendor code printed on the bill',
    vendor_name         VARCHAR(200)  NOT NULL,
    sac_code            VARCHAR(10)   NOT NULL DEFAULT '996791',
    gst_rate            DECIMAL(5,2)  NOT NULL DEFAULT 5.00,
    tds_percent         DECIMAL(5,2)  NOT NULL DEFAULT 1.00 COMMENT '194C: 1% individual/HUF, 2% others',
    debtor_ledger_id    INT           NULL,
    income_ledger_id    INT           NULL,
    tds_ledger_id       INT           NULL,
    receipt_bank_id     INT           NULL COMMENT 'm_bank the bank part of the payment lands in',
    start_date          DATE          NOT NULL COMMENT 'bills dated before this are not taken',
    active_flag         CHAR(1)       NOT NULL DEFAULT 'Y',
    notes               VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (vendor_id),
    UNIQUE KEY uniq_tt_vendor (location_code, oil_company, vendor_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS m_tt_vehicle (
    vehicle_id          INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    vehicle_no          VARCHAR(20)   NOT NULL,
    vendor_id           INT           NULL,
    capacity_kl         DECIMAL(6,2)  NULL,
    fleet_card_id       VARCHAR(30)   NULL COMMENT 'XtraPower customer id',
    insurance_expiry    DATE          NULL,
    fc_expiry           DATE          NULL,
    permit_expiry       DATE          NULL,
    tax_expiry          DATE          NULL,
    active_flag         CHAR(1)       NOT NULL DEFAULT 'Y',
    notes               VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (vehicle_id),
    UNIQUE KEY uniq_tt_vehicle (location_code, vehicle_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Amounts: taxable = gross - penalty. cgst/sgst/igst = taxable x rate (what GSTR-1 files);
-- bill_cgst/... = as printed (sum of per-trip rounding). GST is paid by IOCL under reverse
-- charge, so what IOCL owes is net_receivable = taxable - TDS.
CREATE TABLE IF NOT EXISTS t_tt_invoice (
    invoice_id          INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    vendor_id           INT           NOT NULL,
    bill_no             VARCHAR(30)   NOT NULL,
    bill_date           DATE          NOT NULL,
    period_from         DATE          NULL,
    period_to           DATE          NULL,
    generated_on        DATE          NULL,
    reverse_charge      CHAR(1)       NOT NULL DEFAULT 'Y',
    recipient_name      VARCHAR(200)  NULL,
    recipient_gstin     VARCHAR(15)   NOT NULL,
    recipient_address   VARCHAR(300)  NULL,
    sac_code            VARCHAR(10)   NOT NULL,
    gst_rate            DECIMAL(5,2)  NOT NULL,
    gross_amount        DECIMAL(12,2) NOT NULL,
    penalty_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    taxable_value       DECIMAL(12,2) NOT NULL,
    cgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    igst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    bill_cgst           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    bill_sgst           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    bill_igst           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    invoice_value       DECIMAL(12,2) NOT NULL COMMENT 'taxable + GST, as reported in GSTR-1',
    tds_percent         DECIMAL(5,2)  NOT NULL,
    tds_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_receivable      DECIMAL(12,2) NOT NULL,
    trip_count          INT           NOT NULL DEFAULT 0,
    total_kl            DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    vehicles            VARCHAR(200)  NULL,
    file_name           VARCHAR(200)  NULL,
    notes               VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (invoice_id),
    UNIQUE KEY uniq_tt_bill_no (location_code, bill_no),
    KEY idx_tt_invoice_date (location_code, bill_date),
    CONSTRAINT fk_tt_invoice_vendor FOREIGN KEY (vendor_id) REFERENCES m_tt_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_tt_invoice_line (
    line_id             INT           NOT NULL AUTO_INCREMENT,
    invoice_id          INT           NOT NULL,
    sno                 INT           NOT NULL,
    vehicle_no          VARCHAR(20)   NULL,
    delivery_invoice_no VARCHAR(20)   NULL,
    item_no             VARCHAR(10)   NULL,
    delivery_date       DATE          NULL,
    ship_to_code        VARCHAR(20)   NULL,
    ship_to_name        VARCHAR(200)  NULL,
    material_code       VARCHAR(20)   NULL,
    qty_kl              DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    shortage            DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    rtd_p               DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    rtd_h               DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    rtd_hh              DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    rate_p              DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
    rate_h              DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
    rate_hh             DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
    gross_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    penalty_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    igst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (line_id),
    KEY idx_tt_line_invoice (invoice_id),
    CONSTRAINT fk_tt_line_invoice FOREIGN KEY (invoice_id) REFERENCES t_tt_invoice (invoice_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_tt_invoice_deleted (
    deleted_id          INT           NOT NULL AUTO_INCREMENT,
    invoice_id          INT           NOT NULL,
    location_code       VARCHAR(50)   NOT NULL,
    bill_no             VARCHAR(30)   NOT NULL,
    bill_date           DATE          NOT NULL,
    taxable_value       DECIMAL(12,2) NOT NULL,
    tds_amount          DECIMAL(12,2) NOT NULL,
    net_receivable      DECIMAL(12,2) NOT NULL,
    invoice_data        JSON          NULL,
    delete_reason       VARCHAR(300)  NULL,
    deleted_by          VARCHAR(45)   NULL,
    deleted_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (deleted_id),
    KEY idx_tt_deleted_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SAC for GSTR-1 Table 12 --------------------------------------------------
INSERT IGNORE INTO m_gst_hsn (hsn_code, description, created_by) VALUES
('996791', 'Goods transport agency services for road transport', 'system');

-- Ledgers ------------------------------------------------------------------
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT g.location_code, 'IOCL - TT FREIGHT', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM gl_ledger_groups g
WHERE g.location_code IN ('MC', 'MME') AND g.group_name = 'Sundry Debtors'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = g.location_code AND l.ledger_name = 'IOCL - TT FREIGHT');

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT g.location_code, 'TDS RECEIVABLE', g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM gl_ledger_groups g
WHERE g.location_code IN ('MC', 'MME') AND g.group_name = 'Current Assets'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = g.location_code AND l.ledger_name = 'TDS RECEIVABLE');

-- Vendors: income on the existing tank truck rent ledgers; receipt bank = the IOB current
-- account the bank part has always been credited to (MC "CC003" = 016302000000003).
INSERT INTO m_tt_vendor (location_code, oil_company, vendor_code, vendor_name, sac_code, gst_rate, tds_percent,
                         debtor_ledger_id, income_ledger_id, tds_ledger_id, receipt_bank_id, start_date, created_by, updated_by)
SELECT v.location_code, 'IOCL', v.vendor_code, v.vendor_name, '996791', 5.00, v.tds_percent,
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = v.location_code AND ledger_name = 'IOCL - TT FREIGHT' LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = v.location_code AND ledger_name = v.income_ledger LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = v.location_code AND ledger_name = 'TDS RECEIVABLE' LIMIT 1),
       (SELECT bank_id FROM m_bank WHERE location_code = v.location_code AND account_number = v.bank_account LIMIT 1),
       '2026-04-01', 'system', 'system'
FROM (
    SELECT 'MC' AS location_code, '10134943' AS vendor_code, 'MUTHU CORPORATION' AS vendor_name, 1.00 AS tds_percent,
           'TANK TRUCK RENT RECEIVED' AS income_ledger, '016302000000003' AS bank_account
    UNION ALL
    SELECT 'MME', '11040362', 'MUTHUMANI ENTERPRISES', 2.00, 'TANKER TRUCK RENT', '016302000000009'
) v
WHERE EXISTS (SELECT 1 FROM m_location l WHERE l.location_code = v.location_code)
  AND NOT EXISTS (SELECT 1 FROM m_tt_vendor x WHERE x.location_code = v.location_code AND x.oil_company = 'IOCL' AND x.vendor_code = v.vendor_code);

INSERT INTO m_tt_vehicle (location_code, vehicle_no, vendor_id, capacity_kl, fleet_card_id, created_by, updated_by)
SELECT v.location_code, v.vehicle_no,
       (SELECT vendor_id FROM m_tt_vendor WHERE location_code = v.location_code AND oil_company = 'IOCL' LIMIT 1),
       12.00, v.card, 'system', 'system'
FROM (SELECT 'MC' AS location_code, 'TN39BY1899' AS vehicle_no, '1000909010' AS card
      UNION ALL SELECT 'MME', 'TN39BV2599', NULL) v
WHERE EXISTS (SELECT 1 FROM m_location l WHERE l.location_code = v.location_code)
  AND NOT EXISTS (SELECT 1 FROM m_tt_vehicle x WHERE x.location_code = v.location_code AND x.vehicle_no = v.vehicle_no);

-- Bank receipt label -> debtor ledger ----------------------------------------
INSERT INTO m_ledger_rules
    (location_code, bank_id, source_type, external_id, ledger_name, allowed_entry_type,
     notes_required_flag, allow_split_flag, created_by, updated_by, effective_start_date)
SELECT v.location_code, v.receipt_bank_id, 'Static', NULL, 'TT FREIGHT - IOCL', 'CREDIT', 'N', 'Y', 'system', 'system', '2026-04-01'
FROM m_tt_vendor v
WHERE v.oil_company = 'IOCL' AND v.receipt_bank_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM m_ledger_rules r
                  WHERE r.location_code = v.location_code AND r.bank_id = v.receipt_bank_id
                    AND r.source_type = 'Static' AND r.ledger_name = 'TT FREIGHT - IOCL');

INSERT INTO gl_static_ledger_map (location_code, ledger_name, treatment, gl_ledger_id, created_by, updated_by)
SELECT v.location_code, 'TT FREIGHT - IOCL', 'POST', v.debtor_ledger_id, 'system', 'system'
FROM m_tt_vendor v
WHERE v.oil_company = 'IOCL' AND v.debtor_ledger_id IS NOT NULL
ON DUPLICATE KEY UPDATE treatment = 'POST', gl_ledger_id = VALUES(gl_ledger_id), updated_by = 'system';

-- Menus: freight bills under Transactions, vendors + trucks under Masters ----
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, created_by)
VALUES
    ('TT_FREIGHT', 'Tank Truck Freight', 'bi-truck', '/tt', 'TRANSACTIONS', 73, 'TRANSACTIONS', CURDATE(), 'system'),
    ('TT_MASTER', 'Tank Truck Master', 'bi-truck-front', '/tt/master', 'MASTERS', 67, 'MASTERS', CURDATE(), 'system');

INSERT INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT r.role, l.location_code, m.menu_code, 1, CURDATE(), 'system', 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') r
CROSS JOIN (SELECT 'MC' AS location_code UNION ALL SELECT 'MME') l
CROSS JOIN (SELECT 'TT_FREIGHT' AS menu_code UNION ALL SELECT 'TT_MASTER') m
WHERE EXISTS (SELECT 1 FROM m_location x WHERE x.location_code = l.location_code)
  AND NOT EXISTS (
    SELECT 1 FROM m_menu_access_override o
    WHERE o.role = r.role AND o.location_code = l.location_code AND o.menu_code = m.menu_code
);

CALL RefreshMenuCache();

-- Verify
SELECT v.location_code, v.vendor_code, v.vendor_name, v.tds_percent, v.debtor_ledger_id, v.income_ledger_id,
       v.tds_ledger_id, v.receipt_bank_id, v.start_date
FROM m_tt_vendor v ORDER BY v.location_code;
SELECT location_code, vehicle_no, fleet_card_id FROM m_tt_vehicle ORDER BY location_code;
SELECT 'menu access' AS what, COUNT(*) AS n FROM m_menu_access_override WHERE menu_code IN ('TT_FREIGHT', 'TT_MASTER');
