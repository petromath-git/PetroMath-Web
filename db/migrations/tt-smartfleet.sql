-- ============================================================================
-- Tank Truck Freight: BPCL SmartFleet card statements at SFS (tkt #494)
-- Run after tt-fleet-card.sql and tt-bpcl.sql.
--
-- BPCL recharges SFS's SmartFleet card (account FA2000099448, card FC0001613115) out of the
-- freight payment: the "Loss Recovery" on the AP210 payment advice. The truck buys diesel with
-- it at SFS's own bunk. Statements upload in /tt?tab=card next to XTRAPOWER ones.
--
-- 1. m_tt_fleet_card.program: XTRAPOWER (IOCL) or SMARTFLEET (BPCL).
-- 2. SFS card, linked to the BPCL vendor 215266 and truck TN21AT3466.
-- 3. SFS ledgers: SMARTFLEET CARD - FA2000099448 (Current Assets), TANK TRUCK DIESEL.
--    Petromiles are kept as points only (rupee value not known), so no loyalty ledgers.
--
-- GL (TT_CARD_STATEMENT): Recharge card Dr / BPCL - TT FREIGHT Cr; Sale TANK TRUCK DIESEL Dr / card Cr.
-- Safe to re-run.
-- ============================================================================

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_tt_fleet_card' AND COLUMN_NAME = 'program');
SET @s := IF(@c = 0,
    "ALTER TABLE m_tt_fleet_card ADD COLUMN program VARCHAR(20) NOT NULL DEFAULT 'XTRAPOWER' COMMENT 'XTRAPOWER (IOCL) or SMARTFLEET (BPCL)' AFTER customer_name",
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Card ----------------------------------------------------------------------
INSERT INTO m_tt_fleet_card (location_code, customer_id, customer_name, program, vendor_id, vehicle_id, tds_ledger_id,
                             start_date, created_by, updated_by)
SELECT 'SFS', 'FA2000099448', 'SRINIVASA FILLING STATION', 'SMARTFLEET', v.vendor_id,
       (SELECT vehicle_id FROM m_tt_vehicle WHERE location_code = 'SFS' AND vehicle_no = 'TN21AT3466' LIMIT 1),
       (SELECT ledger_id FROM gl_ledgers WHERE location_code = 'SFS' AND ledger_name = 'TDS RECEIVABLE' LIMIT 1),
       '2026-04-01', 'system', 'system'
FROM m_tt_vendor v
WHERE v.location_code = 'SFS' AND v.oil_company = 'BPCL' AND v.vendor_code = '215266'
  AND NOT EXISTS (SELECT 1 FROM m_tt_fleet_card x WHERE x.location_code = 'SFS' AND x.customer_id = 'FA2000099448');

UPDATE m_tt_vehicle h JOIN m_tt_fleet_card c ON c.location_code = h.location_code AND c.vehicle_id = h.vehicle_id
SET h.fleet_card_id = c.customer_id
WHERE c.location_code = 'SFS' AND h.fleet_card_id IS NULL;

-- Ledgers -------------------------------------------------------------------
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT c.location_code, CONCAT('SMARTFLEET CARD - ', c.customer_id), g.group_id, 'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
JOIN gl_ledger_groups g ON g.location_code = c.location_code AND g.group_name = 'Current Assets'
WHERE c.program = 'SMARTFLEET'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = CONCAT('SMARTFLEET CARD - ', c.customer_id));

-- Diesel goes in the same group as an existing TANK TRUCK EXPENSES ledger (else Indirect Expenses)
INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT c.location_code, 'TANK TRUCK DIESEL',
       COALESCE((SELECT e.group_id FROM gl_ledgers e WHERE e.location_code = c.location_code AND e.ledger_name = 'TANK TRUCK EXPENSES' LIMIT 1),
                (SELECT g.group_id FROM gl_ledger_groups g WHERE g.location_code = c.location_code AND g.group_name = 'Indirect Expenses' LIMIT 1)),
       'SYSTEM', 'Y', 'system', 'system'
FROM m_tt_fleet_card c
WHERE c.program = 'SMARTFLEET'
  AND NOT EXISTS (SELECT 1 FROM gl_ledgers l WHERE l.location_code = c.location_code AND l.ledger_name = 'TANK TRUCK DIESEL');

UPDATE m_tt_fleet_card c
SET c.wallet_ledger_id = COALESCE(c.wallet_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = CONCAT('SMARTFLEET CARD - ', c.customer_id) LIMIT 1)),
    c.diesel_ledger_id = COALESCE(c.diesel_ledger_id,
        (SELECT ledger_id FROM gl_ledgers WHERE location_code = c.location_code AND ledger_name = 'TANK TRUCK DIESEL' LIMIT 1)),
    c.updated_by = 'system'
WHERE c.program = 'SMARTFLEET';

-- Verify
SELECT c.location_code, c.customer_id, c.program, c.vendor_id, c.vehicle_id, c.wallet_ledger_id, c.diesel_ledger_id,
       c.tds_ledger_id, c.start_date
FROM m_tt_fleet_card c ORDER BY c.location_code;
