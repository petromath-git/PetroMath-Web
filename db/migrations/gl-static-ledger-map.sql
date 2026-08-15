-- ============================================================
-- GL Accounting: explicit mapping for Static bank/SOA ledger labels
-- Generated: 2026-08-15
--
-- Replaces exact-name matching between t_bank_transaction.ledger_name
-- (a free-text label a user typed into the bank-reconciliation "ledger
-- rules" screen — a feature that predates the GL engine) and gl_ledgers.
-- Name-matching is fragile: two different users can create differently
-- named Static labels for the same real ledger, or a label can drift
-- from / coincidentally collide with an unrelated GL ledger name, and
-- nothing would catch it before money posts to the wrong place.
--
-- gl_static_ledger_map makes the mapping an explicit, reviewed decision
-- instead: many Static labels -> one GL ledger is fine (enforced by
-- gl_ledger_id having no uniqueness constraint), the reverse is not
-- (enforced by the UNIQUE(location_code, ledger_name) key — one label
-- always means exactly one thing). Unreviewed labels never block
-- processing and never guess — they post to a visible per-location
-- "Unclassified Bank Transaction" ledger until reviewed.
-- ============================================================


-- ── Step 1: Mapping table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gl_static_ledger_map (
    map_id          INT NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50)  NOT NULL,
    ledger_name     VARCHAR(250) NOT NULL COMMENT 'The Static label as it appears in t_bank_transaction.ledger_name',
    treatment       ENUM('POST', 'SKIP') NULL COMMENT 'NULL = not yet reviewed',
    gl_ledger_id    INT NULL COMMENT 'Required when treatment=POST',
    skip_reason     VARCHAR(255) NULL COMMENT 'Required when treatment=SKIP, e.g. "Duplicate of TANK_INVOICE purchase — SOA mirror line"',
    created_by      VARCHAR(45),
    updated_by      VARCHAR(45),
    creation_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (map_id),
    UNIQUE KEY uq_gl_static_ledger_map (location_code, ledger_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Step 2: "Unclassified Bank Transaction" fallback ledger per location ──────
-- Only for locations that already have GL set up. Safe to re-run.

INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, active_flag, created_by, updated_by)
SELECT DISTINCT loc.location_code, 'Unclassified Bank Transaction', g.group_id, 'STATIC', 'Y', 'MIGRATION', 'MIGRATION'
FROM (SELECT DISTINCT location_code FROM gl_ledgers) loc
JOIN gl_ledger_groups g ON g.location_code = loc.location_code AND g.group_name = 'Suspense A/c'
WHERE NOT EXISTS (
    SELECT 1 FROM gl_ledgers x WHERE x.location_code = loc.location_code AND x.ledger_name = 'Unclassified Bank Transaction'
);


-- ── Step 3: Seed the map with every distinct Static label already in use ─────
-- Unreviewed (treatment=NULL) by default — gives whoever reviews this a
-- concrete checklist instead of a blank table. Covers both the main
-- transaction table and split legs, since either can carry a Static label.

INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
SELECT DISTINCT mb.location_code, tbt.ledger_name, 'MIGRATION', 'MIGRATION'
FROM t_bank_transaction tbt
JOIN m_bank mb ON mb.bank_id = tbt.bank_id
WHERE tbt.ledger_name IS NOT NULL
  AND (LOWER(tbt.external_source) = 'static' OR tbt.external_source IS NULL)
  AND tbt.ledger_name <> 'Others';

INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
SELECT DISTINCT mb.location_code, tbs.ledger_name, 'MIGRATION', 'MIGRATION'
FROM t_bank_transaction_splits tbs
JOIN t_bank_transaction tbt ON tbt.t_bank_id = tbs.t_bank_id
JOIN m_bank mb ON mb.bank_id = tbt.bank_id
WHERE tbs.ledger_name IS NOT NULL
  AND LOWER(tbs.external_source) = 'static';


-- ── Step 4: SFS — pre-reviewed during this session, confirmed against real data ─
-- Both are SOA invoice-debit mirrors of tank invoices already journaled via
-- TANK_INVOICE (dates/amounts checked to match exactly) — correctly SKIP.

UPDATE gl_static_ledger_map
SET treatment = 'SKIP',
    skip_reason = 'Duplicate of TANK_INVOICE purchase — BPCL SOA mirror line, amounts/dates confirmed matching real tank invoices',
    updated_by = 'ADMIN'
WHERE location_code = 'SFS' AND ledger_name IN ('PURCHASE DIESEL', 'PURCHASE OTHERS');


-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT location_code, ledger_name, treatment, skip_reason
FROM gl_static_ledger_map
ORDER BY location_code, (treatment IS NULL) DESC, ledger_name;
