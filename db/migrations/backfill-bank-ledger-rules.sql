-- ============================================================================
-- backfill-bank-ledger-rules.sql
-- ============================================================================
-- One-time backfill to seed m_ledger_rules with source_type = 'Bank' rows
-- for all existing active banks.
--
-- Going forward, the after_bank_insert_ledger_rule and
-- after_bank_update_ledger_rule triggers (in bank-ledger-list-update.sql)
-- keep these rules in sync automatically.
--
-- Safe to re-run: INSERT IGNORE skips rows that already exist.
-- ============================================================================


-- ── Before: see what exists already ─────────────────────────────────────────
SELECT
    mb.bank_name,
    mb.account_nickname,
    mb.internal_flag,
    mb.is_oil_company,
    mb.active_flag,
    COUNT(lr.rule_id) AS existing_bank_rules
FROM m_bank mb
LEFT JOIN m_ledger_rules lr
    ON  lr.bank_id     = mb.bank_id
    AND lr.source_type = 'Bank'
    AND (lr.effective_end_date IS NULL OR lr.effective_end_date >= CURDATE())
GROUP BY mb.bank_id, mb.bank_name, mb.account_nickname,
         mb.internal_flag, mb.is_oil_company, mb.active_flag
ORDER BY mb.is_oil_company, mb.internal_flag, mb.bank_name;


-- ── 1. Internal bank ↔ internal bank (BOTH directions) ───────────────────────
-- Every active internal bank gets a BOTH rule for every other active internal
-- bank in the same location.  Two rows per pair (one for each direction).
INSERT IGNORE INTO m_ledger_rules (
    location_code, bank_id, source_type, external_id,
    ledger_name, allowed_entry_type, notes_required_flag,
    created_by, creation_date, effective_start_date, effective_end_date
)
SELECT
    mb1.location_code,
    mb1.bank_id,
    'Bank',
    mb2.bank_id,
    NULL,
    'BOTH',
    'N',
    'system', NOW(), CURDATE(), '2400-01-01'
FROM m_bank mb1
JOIN m_bank mb2
    ON  mb2.location_code = mb1.location_code
    AND mb2.bank_id      != mb1.bank_id
    AND mb2.internal_flag = 'Y'
    AND mb2.active_flag   = 'Y'
WHERE mb1.internal_flag = 'Y'
  AND mb1.active_flag   = 'Y';


-- ── 2. Oil company bank ← real banks (CREDIT) ────────────────────────────────
-- Every active oil company bank gets a CREDIT rule for every active real bank
-- in the same location.  When a real bank payment arrives in the oil company
-- account, the real bank is the contra ledger.
INSERT IGNORE INTO m_ledger_rules (
    location_code, bank_id, source_type, external_id,
    ledger_name, allowed_entry_type, notes_required_flag,
    created_by, creation_date, effective_start_date, effective_end_date
)
SELECT
    mb_oc.location_code,
    mb_oc.bank_id,
    'Bank',
    mb_real.bank_id,
    NULL,
    'CREDIT',
    'N',
    'system', NOW(), CURDATE(), '2400-01-01'
FROM m_bank mb_oc
JOIN m_bank mb_real
    ON  mb_real.location_code  = mb_oc.location_code
    AND mb_real.bank_id       != mb_oc.bank_id
    AND mb_real.is_oil_company = 'N'
    AND mb_real.active_flag    = 'Y'
WHERE mb_oc.is_oil_company = 'Y'
  AND mb_oc.active_flag    = 'Y';


-- ── After: verify rules created ──────────────────────────────────────────────
SELECT
    mb.bank_name,
    mb.account_nickname,
    mb.internal_flag,
    mb.is_oil_company,
    lr.allowed_entry_type,
    mb2.bank_name       AS contra_bank_name,
    mb2.account_nickname AS contra_nickname
FROM m_ledger_rules lr
JOIN m_bank mb  ON lr.bank_id     = mb.bank_id
JOIN m_bank mb2 ON lr.external_id = mb2.bank_id
WHERE lr.source_type = 'Bank'
  AND (lr.effective_end_date IS NULL OR lr.effective_end_date >= CURDATE())
ORDER BY mb.is_oil_company, mb.internal_flag, mb.bank_name, mb2.bank_name;


-- ── Sanity checks ────────────────────────────────────────────────────────────

-- Should be 0: oil company bank with no Bank-source rules
-- (means it has no real banks as contra ledger options)
SELECT COUNT(*) AS oil_co_banks_without_rules
FROM m_bank mb_oc
WHERE mb_oc.is_oil_company = 'Y'
  AND mb_oc.active_flag    = 'Y'
  AND NOT EXISTS (
      SELECT 1 FROM m_ledger_rules lr
      WHERE lr.bank_id     = mb_oc.bank_id
        AND lr.source_type = 'Bank'
        AND (lr.effective_end_date IS NULL OR lr.effective_end_date >= CURDATE())
  );

-- Should be 0: internal bank with no BOTH rules pointing to other internal banks
SELECT COUNT(*) AS internal_banks_without_rules
FROM m_bank mb
WHERE mb.internal_flag = 'Y'
  AND mb.active_flag   = 'Y'
  AND NOT EXISTS (
      SELECT 1 FROM m_ledger_rules lr
      WHERE lr.bank_id          = mb.bank_id
        AND lr.source_type      = 'Bank'
        AND lr.allowed_entry_type = 'BOTH'
        AND (lr.effective_end_date IS NULL OR lr.effective_end_date >= CURDATE())
  )
  AND EXISTS (
      -- only flag if there IS another internal bank to pair with
      SELECT 1 FROM m_bank mb2
      WHERE mb2.location_code = mb.location_code
        AND mb2.bank_id      != mb.bank_id
        AND mb2.internal_flag = 'Y'
        AND mb2.active_flag   = 'Y'
  );
