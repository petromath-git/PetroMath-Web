-- ============================================================================
-- bank-ledger-list-update.sql
-- ============================================================================
-- Purpose:
--   1. Seed m_ledger_rules with source_type = 'Bank' rows so that other bank
--      accounts appear in each bank's allowed ledger list — consistent with
--      how Supplier and Credit sources are managed.
--        a. Internal bank ↔ internal bank pairs  (allowed_entry_type = BOTH)
--        b. Oil company bank ← real banks         (allowed_entry_type = CREDIT)
--           Oil company receives a credit when a real bank makes a payment.
--
--   2. Extend m_bank_allowed_ledgers_v to resolve source_type = 'Bank' rows
--      by joining to m_bank (parallel to Supplier → m_supplier join).
--
--   3. Backfill existing t_bank_transaction rows that are unclassified (null /
--      OTHERS ledger) and can be auto-matched to their contra bank entry:
--        a. Intra-bank debit  entries (internal_flag = Y, debit  > 0)
--        b. Intra-bank credit entries (internal_flag = Y, credit > 0)
--        c. Oil company credit mirrors (is_oil_company = Y, credit > 0)
--
--   After this migration, tally-export-v2 can rely on the backfilled
--   ledger_name values instead of the old amount-matching heuristics.
--
-- Safe to re-run:
--   INSERT IGNORE on m_ledger_rules skips duplicates.
--   UPDATEs only touch rows where ledger_name IS NULL / OTHERS.
-- ============================================================================


-- ── 1. Seed m_ledger_rules — Bank source type ────────────────────────────────

-- 1a. Internal bank ↔ internal bank (intra-bank transfers, both directions)
INSERT IGNORE INTO m_ledger_rules
    (location_code, bank_id, source_type, external_id, allowed_entry_type, notes_required_flag)
SELECT
    mb1.location_code,
    mb1.bank_id,
    'Bank',
    mb2.bank_id,
    'BOTH',
    'N'
FROM m_bank mb1
JOIN m_bank mb2
    ON  mb2.location_code = mb1.location_code
    AND mb2.bank_id      != mb1.bank_id
    AND mb2.active_flag   = 'Y'
    AND mb2.internal_flag = 'Y'
WHERE mb1.active_flag   = 'Y'
  AND mb1.internal_flag = 'Y';

-- 1b. Oil company bank ← real banks
--     (oil company credit = payment mirror: real bank is the contra)
INSERT IGNORE INTO m_ledger_rules
    (location_code, bank_id, source_type, external_id, allowed_entry_type, notes_required_flag)
SELECT
    mb_oc.location_code,
    mb_oc.bank_id,
    'Bank',
    mb_real.bank_id,
    'CREDIT',
    'N'
FROM m_bank mb_oc
JOIN m_bank mb_real
    ON  mb_real.location_code  = mb_oc.location_code
    AND mb_real.is_oil_company = 'N'
    AND mb_real.active_flag    = 'Y'
WHERE mb_oc.is_oil_company = 'Y'
  AND mb_oc.active_flag    = 'Y';


-- ── 2. Update m_bank_allowed_ledgers_v ──────────────────────────────────────
--    Adds the Bank source type alongside Supplier, Credit, Static.
--    source_type = 'Bank': external_id = bank_id in m_bank.
--    ledger_name / ledger_display_name resolved from m_bank (same pattern
--    as Supplier → m_supplier, Credit → m_credit_list).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW m_bank_allowed_ledgers_v AS
SELECT
    lr.rule_id,
    lr.location_code,
    lr.bank_id,
    lr.source_type,
    lr.external_id,
    lr.allowed_entry_type,
    lr.notes_required_flag,
    lr.max_amount,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_name
        WHEN lr.source_type = 'Credit'   THEN mcl.Company_Name
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN mb2.ledger_name
    END AS ledger_name,
    CASE
        WHEN lr.source_type = 'Supplier' THEN ms.supplier_short_name
        WHEN lr.source_type = 'Credit'   THEN mcl.Company_Name
        WHEN lr.source_type = 'Static'   THEN lr.ledger_name
        WHEN lr.source_type = 'Bank'     THEN
            CONCAT(mb2.bank_name,
                   IF(mb2.account_nickname IS NOT NULL AND mb2.account_nickname != '',
                      CONCAT(' (', mb2.account_nickname, ')'), ''))
    END AS ledger_display_name
FROM m_ledger_rules lr
LEFT JOIN m_supplier ms
    ON  lr.source_type = 'Supplier'
    AND lr.external_id = ms.supplier_id
    AND COALESCE(ms.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_credit_list mcl
    ON  lr.source_type = 'Credit'
    AND lr.external_id = mcl.creditlist_id
    AND COALESCE(mcl.effective_end_date, '9999-12-31') > CURDATE()
LEFT JOIN m_bank mb2
    ON  lr.source_type = 'Bank'
    AND lr.external_id = mb2.bank_id
    AND mb2.active_flag = 'Y'
WHERE lr.source_type = 'Static'
   OR (lr.source_type = 'Supplier' AND ms.supplier_id    IS NOT NULL)
   OR (lr.source_type = 'Credit'   AND mcl.creditlist_id IS NOT NULL)
   OR (lr.source_type = 'Bank'     AND mb2.bank_id       IS NOT NULL)
ORDER BY source_type, ledger_display_name;


-- ── 3a. Backfill — intra-bank DEBIT entries ──────────────────────────────────
--    Unclassified debit on an internal bank matched to a corresponding
--    unclassified credit on another internal bank (same date, same amount).
--    Sets ledger_name = contra bank's m_bank.ledger_name.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
JOIN (
    SELECT
        tbt1.t_bank_id,
        mb2.ledger_name AS contra_ledger,
        mb2.bank_id     AS contra_bank_id
    FROM t_bank_transaction tbt1
    JOIN m_bank mb1 ON tbt1.bank_id = mb1.bank_id
    JOIN t_bank_transaction tbt2
        ON  DATE(tbt2.trans_date)       = DATE(tbt1.trans_date)
        AND tbt2.credit_amount          = tbt1.debit_amount
        AND IFNULL(tbt2.debit_amount,0) = 0
        AND IFNULL(tbt2.ledger_name,'') IN ('', 'OTHERS')
    JOIN m_bank mb2
        ON  tbt2.bank_id       = mb2.bank_id
        AND mb2.internal_flag  = 'Y'
        AND mb2.location_code  = mb1.location_code
        AND mb2.bank_id       != mb1.bank_id
    WHERE tbt1.debit_amount     > 0
      AND mb1.internal_flag     = 'Y'
      AND IFNULL(tbt1.ledger_name, '') IN ('', 'OTHERS')
      AND tbt1.trans_date       >= '2025-04-01'
) paired ON paired.t_bank_id = tbt.t_bank_id
SET
    tbt.ledger_name     = paired.contra_ledger,
    tbt.external_id     = paired.contra_bank_id,
    tbt.external_source = 'Bank';


-- ── 3b. Backfill — intra-bank CREDIT entries ─────────────────────────────────
UPDATE t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
JOIN (
    SELECT
        tbt1.t_bank_id,
        mb2.ledger_name AS contra_ledger,
        mb2.bank_id     AS contra_bank_id
    FROM t_bank_transaction tbt1
    JOIN m_bank mb1 ON tbt1.bank_id = mb1.bank_id
    JOIN t_bank_transaction tbt2
        ON  DATE(tbt2.trans_date)        = DATE(tbt1.trans_date)
        AND tbt2.debit_amount            = tbt1.credit_amount
        AND IFNULL(tbt2.credit_amount,0) = 0
        AND IFNULL(tbt2.ledger_name,'')  IN ('', 'OTHERS')
    JOIN m_bank mb2
        ON  tbt2.bank_id       = mb2.bank_id
        AND mb2.internal_flag  = 'Y'
        AND mb2.location_code  = mb1.location_code
        AND mb2.bank_id       != mb1.bank_id
    WHERE tbt1.credit_amount    > 0
      AND mb1.internal_flag     = 'Y'
      AND IFNULL(tbt1.ledger_name, '') IN ('', 'OTHERS')
      AND tbt1.trans_date       >= '2025-04-01'
) paired ON paired.t_bank_id = tbt.t_bank_id
SET
    tbt.ledger_name     = paired.contra_ledger,
    tbt.external_id     = paired.contra_bank_id,
    tbt.external_source = 'Bank';


-- ── 3c. Backfill — oil company CREDIT mirrors ────────────────────────────────
--    Unclassified credit on an oil company bank matched to a real bank debit
--    (same date, same amount).  Sets ledger_name = real bank's m_bank.ledger_name
--    so the tally-export-v2 NOT EXISTS check correctly skips it.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
JOIN (
    SELECT
        tbt_oc.t_bank_id,
        mb_real.ledger_name AS contra_ledger,
        mb_real.bank_id     AS contra_bank_id
    FROM t_bank_transaction tbt_oc
    JOIN m_bank mb_oc
        ON  tbt_oc.bank_id       = mb_oc.bank_id
        AND mb_oc.is_oil_company = 'Y'
    JOIN t_bank_transaction tbt_real
        ON  DATE(tbt_real.trans_date) = DATE(tbt_oc.trans_date)
        AND tbt_real.debit_amount     = tbt_oc.credit_amount
        AND tbt_real.closed_flag      = 'Y'
    JOIN m_bank mb_real
        ON  tbt_real.bank_id        = mb_real.bank_id
        AND mb_real.is_oil_company  = 'N'
        AND mb_real.location_code   = mb_oc.location_code
    WHERE tbt_oc.credit_amount      > 0
      AND tbt_oc.closed_flag        = 'Y'
      AND IFNULL(tbt_oc.ledger_name, '') IN ('', 'OTHERS')
      AND tbt_oc.trans_date         >= '2025-04-01'
) paired ON paired.t_bank_id = tbt.t_bank_id
SET
    tbt.ledger_name     = paired.contra_ledger,
    tbt.external_id     = paired.contra_bank_id,
    tbt.external_source = 'Bank';


-- ── 4. Triggers on m_bank ────────────────────────────────────────────────────
--
-- after_bank_insert_ledger_rule
--   Mirrors the pattern of after_creditlist_insert_ledger_rule.
--   When a bank is created it seeds Bank-source rules on the relevant peer
--   banks so the new bank immediately appears in their ledger dropdowns.
--
--   Three cases (a bank can be at most one of these in practice):
--     internal_flag = 'Y'  → bidirectional BOTH rules with every other
--                             active internal bank in the same location
--     is_oil_company = 'Y' → CREDIT rules on the new bank for every active
--                             real bank in the location (oil co receives
--                             credits when real bank pays)
--     real bank (neither)  → CREDIT rules on every existing oil company bank
--                             pointing to the new bank (real bank becomes a
--                             valid contra ledger for oil co payment mirrors)
--
-- after_bank_update_ledger_rule
--   When active_flag changes to 'N' (bank disabled), expires all Bank-source
--   rules that reference this bank (either as the owning bank or as the
--   external_id contra), so it disappears from all ledger dropdowns.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS after_bank_insert_ledger_rule;
DROP TRIGGER IF EXISTS after_bank_update_ledger_rule;

DELIMITER ;;

CREATE TRIGGER after_bank_insert_ledger_rule
AFTER INSERT ON m_bank
FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        IF NEW.active_flag = 'Y' THEN

            -- ── Case 1: internal bank ─────────────────────────────────────
            -- (a) New bank can see all existing internal banks
            -- (b) All existing internal banks can see the new bank
            IF NEW.internal_flag = 'Y' THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT
                    NEW.location_code, NEW.bank_id, 'Bank', mb.bank_id,
                    NULL, 'BOTH', 'N',
                    'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code = NEW.location_code
                  AND mb.bank_id      != NEW.bank_id
                  AND mb.internal_flag = 'Y'
                  AND mb.active_flag   = 'Y';

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT
                    NEW.location_code, mb.bank_id, 'Bank', NEW.bank_id,
                    NULL, 'BOTH', 'N',
                    'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code = NEW.location_code
                  AND mb.bank_id      != NEW.bank_id
                  AND mb.internal_flag = 'Y'
                  AND mb.active_flag   = 'Y';

            END IF;

            -- ── Case 2: oil company bank ──────────────────────────────────
            -- New oil company bank gets CREDIT rules for every active real bank
            -- (real bank is the contra when oil co receives payment)
            IF NEW.is_oil_company = 'Y' THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT
                    NEW.location_code, NEW.bank_id, 'Bank', mb.bank_id,
                    NULL, 'CREDIT', 'N',
                    'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code  = NEW.location_code
                  AND mb.bank_id       != NEW.bank_id
                  AND mb.is_oil_company = 'N'
                  AND mb.active_flag    = 'Y';

            END IF;

            -- ── Case 3: real bank (not oil company) ───────────────────────
            -- Every existing oil company bank in the location gets a CREDIT
            -- rule pointing to this new real bank
            IF NEW.is_oil_company = 'N' OR NEW.is_oil_company IS NULL THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT
                    NEW.location_code, mb.bank_id, 'Bank', NEW.bank_id,
                    NULL, 'CREDIT', 'N',
                    'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code  = NEW.location_code
                  AND mb.bank_id       != NEW.bank_id
                  AND mb.is_oil_company = 'Y'
                  AND mb.active_flag    = 'Y';

            END IF;

        END IF;
    END IF;
END;;


CREATE TRIGGER after_bank_update_ledger_rule
AFTER UPDATE ON m_bank
FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        -- ── Case A: bank deactivated ──────────────────────────────────────────
        -- Expire all Bank-source rules that reference it, in either direction.
        IF NEW.active_flag = 'N' AND OLD.active_flag = 'Y' THEN

            UPDATE m_ledger_rules
            SET effective_end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY),
                updated_by         = 'system',
                updation_date      = NOW()
            WHERE source_type = 'Bank'
              AND (bank_id = NEW.bank_id OR external_id = NEW.bank_id)
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

        END IF;

        -- ── Case B: bank re-activated or reclassified ────────────────────────
        -- Covers two sub-cases:
        --   B1. active_flag N → Y  (re-activation)
        --   B2. active_flag stays Y but internal_flag or is_oil_company changed
        --       (reclassification — same expire-then-reinsert pattern as the
        --        after_creditlist_update_ledger_rule trigger)
        IF NEW.active_flag = 'Y' AND (
               OLD.active_flag = 'N'
            OR NEW.internal_flag          <> OLD.internal_flag
            OR IFNULL(NEW.is_oil_company, 'N') <> IFNULL(OLD.is_oil_company, 'N')
        ) THEN

            -- Expire existing rules before re-seeding (avoids stale rule types
            -- after reclassification, e.g. internal → regular bank)
            UPDATE m_ledger_rules
            SET effective_end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY),
                updated_by         = 'system',
                updation_date      = NOW()
            WHERE source_type = 'Bank'
              AND (bank_id = NEW.bank_id OR external_id = NEW.bank_id)
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

            -- Re-seed based on new type (mirrors INSERT trigger logic)

            IF NEW.internal_flag = 'Y' THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT NEW.location_code, NEW.bank_id, 'Bank', mb.bank_id,
                       NULL, 'BOTH', 'N', 'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code = NEW.location_code
                  AND mb.bank_id      != NEW.bank_id
                  AND mb.internal_flag = 'Y'
                  AND mb.active_flag   = 'Y';

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT NEW.location_code, mb.bank_id, 'Bank', NEW.bank_id,
                       NULL, 'BOTH', 'N', 'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code = NEW.location_code
                  AND mb.bank_id      != NEW.bank_id
                  AND mb.internal_flag = 'Y'
                  AND mb.active_flag   = 'Y';

            END IF;

            IF NEW.is_oil_company = 'Y' THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT NEW.location_code, NEW.bank_id, 'Bank', mb.bank_id,
                       NULL, 'CREDIT', 'N', 'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code  = NEW.location_code
                  AND mb.bank_id       != NEW.bank_id
                  AND mb.is_oil_company = 'N'
                  AND mb.active_flag    = 'Y';

            END IF;

            IF NEW.is_oil_company = 'N' OR NEW.is_oil_company IS NULL THEN

                INSERT IGNORE INTO m_ledger_rules (
                    location_code, bank_id, source_type, external_id,
                    ledger_name, allowed_entry_type, notes_required_flag,
                    created_by, creation_date, effective_start_date, effective_end_date
                )
                SELECT NEW.location_code, mb.bank_id, 'Bank', NEW.bank_id,
                       NULL, 'CREDIT', 'N', 'system', NOW(), CURDATE(), '2400-01-01'
                FROM m_bank mb
                WHERE mb.location_code  = NEW.location_code
                  AND mb.bank_id       != NEW.bank_id
                  AND mb.is_oil_company = 'Y'
                  AND mb.active_flag    = 'Y';

            END IF;

        END IF;
    END IF;
END;;

DELIMITER ;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Run after migration. Both should return 0 before running the tally export.

SELECT COUNT(*) AS unmatched_intrabank_debits
FROM t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
WHERE tbt.debit_amount > 0
  AND mb.internal_flag = 'Y'
  AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS');

SELECT COUNT(*) AS unmatched_oilco_credits
FROM t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
WHERE tbt.credit_amount > 0
  AND mb.is_oil_company = 'Y'
  AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS');
