-- ============================================================================
-- Tank Truck Freight: BPCL statements (SFS) + toll invoices, and the TT menus moved under
-- the "Truck Management" head (tkt #494). Run AFTER tt-freight.sql and tt-fleet-card.sql.
--
-- SFS runs a tank truck for BPCL (Ennore Coastal Installation, plant 1352). BPCL SAP prints a
-- monthly statement in SFS's name holding several invoices: DOC ZZ = freight, DOC YB = toll
-- charges recovered from BPCL. Both are GTA under reverse charge. BPCL deducts 194C TDS on
-- freight only and pays the net to SFS's CUB account by NEFT ("215266 PCVO1").
--
-- 1. t_tt_invoice: bill_type (FREIGHT / TOLL), doc_type (SAP document type), ref_doc_no
--    (BPCL FI / LIV document no, the number on the payment advice).
-- 2. m_tt_vendor: toll_ledger_id (income ledger for toll invoices; empty = freight income ledger).
-- 3. SFS: ledgers "BPCL - TT FREIGHT" (Sundry Debtors), "TANK TRUCK FREIGHT - BPCL"
--    (Indirect Incomes), "TDS RECEIVABLE" (Current Assets); vendor 215266 (TDS 2%, toll ledger =
--    the existing "BPCL TOLL REIMBURSEMENT", receipt bank = CUB); truck TN21AT3466; bank label
--    "TT FREIGHT - BPCL" on CUB.
-- 3b. BPCL payment advices (AP210 Excel): payments register, freight lines tied to the bills.
-- 4. Menus: TT_FREIGHT and TT_MASTER move from Transactions / Masters into the Truck Management
--    head (TRUCK_MGMT). The head is granted wherever the TT menus are (Admin, PowerUser,
--    SuperUser at MC, MME, SFS). Truck Load / Truck Expense keep their own grants.
--
-- Safe to re-run.
-- ============================================================================

-- 1. Bill columns --------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_tt_invoice' AND COLUMN_NAME = 'bill_type');
SET @s := IF(@c = 0,
    "ALTER TABLE t_tt_invoice
        ADD COLUMN bill_type  VARCHAR(10) NOT NULL DEFAULT 'FREIGHT' COMMENT 'FREIGHT or TOLL (toll charges recovered from the oil company)' AFTER bill_date,
        ADD COLUMN doc_type   VARCHAR(5)  NULL COMMENT 'oil company SAP document type (BPCL: ZZ freight, YB toll)' AFTER bill_type,
        ADD COLUMN ref_doc_no VARCHAR(20) NULL COMMENT 'oil company FI / LIV document no (BPCL)' AFTER doc_type",
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. Vendor toll ledger -----------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_tt_vendor' AND COLUMN_NAME = 'toll_ledger_id');
SET @s := IF(@c = 0,
    "ALTER TABLE m_tt_vendor ADD COLUMN toll_ledger_id INT NULL COMMENT 'income ledger for toll invoices; NULL = income_ledger_id' AFTER income_ledger_id",
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2b. Payment advices (BPCL AP210 Excel): one row per payment (clearing document), its lines
--     as in the file. Freight lines are tied to the uploaded bill lines by shipment + product
--     (invoice_id / invoice_line_id; re-linked when bills are uploaded later). Register only:
--     nothing is posted to GL from it.
CREATE TABLE IF NOT EXISTS t_tt_payment_advice (
    advice_id           INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    vendor_id           INT           NOT NULL,
    clearing_doc_no     VARCHAR(20)   NOT NULL,
    clearing_date       DATE          NOT NULL,
    advice_period       VARCHAR(7)    NULL COMMENT 'yyyy-mm from the title ("for 09/2026")',
    gross_amount        DECIMAL(12,2) NOT NULL,
    loss_recovery       DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'fleet card debits + any other recovery',
    tds_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_amount          DECIMAL(12,2) NOT NULL COMMENT 'paid to the bank',
    freight_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    toll_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_credit        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    fleet_card_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_recovery      DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'loss recovery not explained by the fleet card lines',
    file_name           VARCHAR(200)  NULL,
    notes               VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (advice_id),
    UNIQUE KEY uniq_tt_advice (location_code, vendor_id, clearing_doc_no),
    KEY idx_tt_advice_date (location_code, clearing_date),
    CONSTRAINT fk_tt_advice_vendor FOREIGN KEY (vendor_id) REFERENCES m_tt_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_tt_payment_advice_line (
    line_id             INT           NOT NULL AUTO_INCREMENT,
    advice_id           INT           NOT NULL,
    sno                 INT           NOT NULL,
    line_kind           VARCHAR(12)   NOT NULL COMMENT 'FREIGHT, TOLL, FLEET_CARD, OTHER',
    txn_date            DATE          NULL,
    doc_no              VARCHAR(20)   NULL COMMENT 'shipment no (freight) or SAP document no',
    vehicle_no          VARCHAR(20)   NULL,
    material_code       VARCHAR(20)   NULL,
    qty_kl              DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    rate                DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    distance            DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    party_name          VARCHAR(100)  NULL,
    tracking_no         VARCHAR(30)   NULL,
    credit_amount       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    debit_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    invoice_id          INT           NULL,
    invoice_line_id     INT           NULL,
    PRIMARY KEY (line_id),
    KEY idx_tt_advice_line (advice_id),
    KEY idx_tt_advice_line_doc (doc_no, material_code),
    KEY idx_tt_advice_line_invline (invoice_line_id),
    CONSTRAINT fk_tt_advice_line FOREIGN KEY (advice_id) REFERENCES t_tt_payment_advice (advice_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. SFS setup ---------------------------------------------------------------------
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT g.location_code, x.ledger_name, g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM (SELECT 'BPCL - TT FREIGHT' AS ledger_name, 'Sundry Debtors' AS group_name
      UNION ALL SELECT 'TANK TRUCK FREIGHT - BPCL', 'Indirect Incomes'
      UNION ALL SELECT 'TDS RECEIVABLE', 'Current Assets') x
JOIN gl_ledger_groups g ON g.location_code = 'SFS' AND g.group_name = x.group_name
WHERE NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = 'SFS' AND l.ledger_name = x.ledger_name);

INSERT INTO m_tt_vendor (location_code, oil_company, vendor_code, vendor_name, sac_code, gst_rate, tds_percent,
                         debtor_ledger_id, income_ledger_id, toll_ledger_id, tds_ledger_id, receipt_bank_id,
                         start_date, notes, created_by, updated_by)
SELECT 'SFS', 'BPCL', '215266', 'SRINIVASA FILLING STATION', '996791', 5.00, 2.00,
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'SFS' AND ledger_name = 'BPCL - TT FREIGHT' LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'SFS' AND ledger_name = 'TANK TRUCK FREIGHT - BPCL' LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'SFS' AND ledger_name = 'BPCL TOLL REIMBURSEMENT' LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'SFS' AND ledger_name = 'TDS RECEIVABLE' LIMIT 1),
       (SELECT bank_id FROM m_bank WHERE location_code = 'SFS' AND account_number = 'CA-510909010107808' LIMIT 1),
       '2026-04-01', 'BPCL Ennore Coastal Installation, plant 1352', 'system', 'system'
FROM DUAL
WHERE EXISTS (SELECT 1 FROM m_location WHERE location_code = 'SFS')
  AND NOT EXISTS (SELECT 1 FROM m_tt_vendor WHERE location_code = 'SFS' AND oil_company = 'BPCL' AND vendor_code = '215266');

INSERT INTO m_tt_vehicle (location_code, vehicle_no, vendor_id, capacity_kl, created_by, updated_by)
SELECT 'SFS', 'TN21AT3466', v.vendor_id, 24.00, 'system', 'system'
FROM m_tt_vendor v
WHERE v.location_code = 'SFS' AND v.oil_company = 'BPCL' AND v.vendor_code = '215266'
  AND NOT EXISTS (SELECT 1 FROM m_tt_vehicle x WHERE x.location_code = 'SFS' AND x.vehicle_no = 'TN21AT3466');

-- Bank receipt label -> debtor ledger (same as the screen's vendor save does)
INSERT INTO m_ledger_rules
    (location_code, bank_id, source_type, external_id, ledger_name, allowed_entry_type,
     notes_required_flag, allow_split_flag, created_by, updated_by, effective_start_date)
SELECT v.location_code, v.receipt_bank_id, 'Static', NULL, 'TT FREIGHT - BPCL', 'CREDIT', 'N', 'Y', 'system', 'system', v.start_date
FROM m_tt_vendor v
WHERE v.location_code = 'SFS' AND v.oil_company = 'BPCL' AND v.receipt_bank_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM m_ledger_rules r
                  WHERE r.location_code = v.location_code AND r.bank_id = v.receipt_bank_id
                    AND r.source_type = 'Static' AND r.ledger_name = 'TT FREIGHT - BPCL');

INSERT INTO gl_static_ledger_map (location_code, ledger_name, treatment, gl_ledger_id, created_by, updated_by)
SELECT v.location_code, 'TT FREIGHT - BPCL', 'POST', v.debtor_ledger_id, 'system', 'system'
FROM m_tt_vendor v
WHERE v.location_code = 'SFS' AND v.oil_company = 'BPCL' AND v.debtor_ledger_id IS NOT NULL
ON DUPLICATE KEY UPDATE treatment = 'POST', gl_ledger_id = VALUES(gl_ledger_id), updated_by = 'system';

-- 4. Menus ---------------------------------------------------------------------------
UPDATE m_menu_items SET parent_code = 'TRUCK_MGMT', group_code = 'TRUCK_MGMT', sequence = 30, updated_by = 'system'
WHERE menu_code = 'TT_FREIGHT';
UPDATE m_menu_items SET parent_code = 'TRUCK_MGMT', group_code = 'TRUCK_MGMT', sequence = 40, updated_by = 'system'
WHERE menu_code = 'TT_MASTER';

-- TT menus at SFS, same roles as MC / MME
INSERT INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT r.role, 'SFS', m.menu_code, 1, CURDATE(), 'system', 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') r
CROSS JOIN (SELECT 'TT_FREIGHT' AS menu_code UNION ALL SELECT 'TT_MASTER') m
WHERE EXISTS (SELECT 1 FROM m_location x WHERE x.location_code = 'SFS')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_override o
                  WHERE o.role = r.role AND o.location_code = 'SFS' AND o.menu_code = m.menu_code);

-- The head, wherever a role has a TT menu (a child without its parent is not shown)
INSERT INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT DISTINCT o.role, o.location_code, 'TRUCK_MGMT', 1, CURDATE(), 'system', 'system'
FROM m_menu_access_override o
WHERE o.menu_code IN ('TT_FREIGHT', 'TT_MASTER') AND o.allowed = 1
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_override x
                  WHERE x.role = o.role AND x.location_code = o.location_code AND x.menu_code = 'TRUCK_MGMT');

CALL RefreshMenuCache();

-- Verify
SELECT v.location_code, v.oil_company, v.vendor_code, v.tds_percent, v.debtor_ledger_id, v.income_ledger_id,
       v.toll_ledger_id, v.tds_ledger_id, v.receipt_bank_id FROM m_tt_vendor v ORDER BY v.location_code;
SELECT menu_code, parent_code, group_code, sequence FROM m_menu_items WHERE group_code = 'TRUCK_MGMT' ORDER BY sequence;
SELECT DISTINCT role, location_code, menu_code FROM user_menu_cache
WHERE menu_code IN ('TRUCK_MGMT', 'TT_FREIGHT', 'TT_MASTER', 'TRUCK_LOAD', 'TRUCK_EXPENSE') ORDER BY location_code, role, menu_code;
