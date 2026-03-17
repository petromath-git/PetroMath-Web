-- ============================================================================
-- preview-bank-transaction-backfill.sql
-- ============================================================================
-- Run these SELECTs before executing the UPDATE statements in
-- bank-ledger-list-update.sql (steps 3a, 3b, 3c).
-- Review the output to confirm the contra bank assignments look correct.
-- ============================================================================


-- ── 3a preview: intra-bank DEBIT entries ─────────────────────────────────────
-- Unclassified debits on internal banks that will be assigned a contra bank.
SELECT
    tbt.t_bank_id,
    DATE_FORMAT(tbt.trans_date, '%d-%m-%Y')  AS trans_date,
    mb1.bank_name                            AS bank,
    mb1.account_nickname                     AS account,
    tbt.debit_amount,
    tbt.remarks,
    tbt.ledger_name                          AS current_ledger,     -- NULL / OTHERS
    mb2.bank_name                            AS will_set_ledger_to,
    mb2.ledger_name                          AS contra_ledger_name,
    mb2.bank_id                              AS will_set_external_id
FROM t_bank_transaction tbt
JOIN m_bank mb1 ON tbt.bank_id = mb1.bank_id
JOIN (
    SELECT
        tbt1.t_bank_id,
        mb2.ledger_name AS contra_ledger,
        mb2.bank_id     AS contra_bank_id,
        mb2.bank_name   AS contra_bank_name
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
JOIN m_bank mb2 ON mb2.bank_id = paired.contra_bank_id
ORDER BY tbt.trans_date, mb1.bank_name;


-- ── 3b preview: intra-bank CREDIT entries ────────────────────────────────────
-- Unclassified credits on internal banks that will be assigned a contra bank.
SELECT
    tbt.t_bank_id,
    DATE_FORMAT(tbt.trans_date, '%d-%m-%Y')  AS trans_date,
    mb1.bank_name                            AS bank,
    mb1.account_nickname                     AS account,
    tbt.credit_amount,
    tbt.remarks,
    tbt.ledger_name                          AS current_ledger,
    mb2.bank_name                            AS will_set_ledger_to,
    mb2.ledger_name                          AS contra_ledger_name,
    mb2.bank_id                              AS will_set_external_id
FROM t_bank_transaction tbt
JOIN m_bank mb1 ON tbt.bank_id = mb1.bank_id
JOIN (
    SELECT
        tbt1.t_bank_id,
        mb2.ledger_name AS contra_ledger,
        mb2.bank_id     AS contra_bank_id,
        mb2.bank_name   AS contra_bank_name
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
JOIN m_bank mb2 ON mb2.bank_id = paired.contra_bank_id
ORDER BY tbt.trans_date, mb1.bank_name;


-- ── 3c preview: oil company CREDIT mirrors ───────────────────────────────────
-- Unclassified credits on oil company banks that will be assigned the
-- real bank that made the corresponding payment.
SELECT
    tbt.t_bank_id,
    DATE_FORMAT(tbt.trans_date, '%d-%m-%Y')  AS trans_date,
    mb_oc.bank_name                          AS oil_co_bank,
    tbt.credit_amount,
    tbt.remarks,
    tbt.ledger_name                          AS current_ledger,
    mb_real.bank_name                        AS will_set_ledger_to,
    mb_real.ledger_name                      AS contra_ledger_name,
    mb_real.bank_id                          AS will_set_external_id,
    -- Show the matching real bank debit for reference
    tbt_real.t_bank_id                       AS matched_real_bank_txn_id,
    tbt_real.debit_amount                    AS real_bank_debit,
    tbt_real.ledger_name                     AS real_bank_ledger,
    tbt_real.remarks                         AS real_bank_remarks
FROM t_bank_transaction tbt
JOIN m_bank mb_oc ON tbt.bank_id = mb_oc.bank_id AND mb_oc.is_oil_company = 'Y'
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
JOIN m_bank mb_real ON mb_real.bank_id = paired.contra_bank_id
-- Re-join to get the real bank transaction details for review
JOIN t_bank_transaction tbt_real
    ON  DATE(tbt_real.trans_date) = DATE(tbt.trans_date)
    AND tbt_real.debit_amount     = tbt.credit_amount
    AND tbt_real.bank_id          = paired.contra_bank_id
ORDER BY tbt.trans_date, mb_oc.bank_name;


-- ── Summary counts ───────────────────────────────────────────────────────────
SELECT
    '3a - intra-bank debits'  AS backfill_type,
    COUNT(*)                  AS rows_to_update
FROM t_bank_transaction tbt
JOIN m_bank mb1 ON tbt.bank_id = mb1.bank_id
WHERE tbt.debit_amount > 0
  AND mb1.internal_flag = 'Y'
  AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS')
  AND tbt.trans_date >= '2025-04-01'
  AND EXISTS (
      SELECT 1 FROM t_bank_transaction tbt2
      JOIN m_bank mb2 ON tbt2.bank_id = mb2.bank_id
      WHERE DATE(tbt2.trans_date)       = DATE(tbt.trans_date)
        AND tbt2.credit_amount          = tbt.debit_amount
        AND IFNULL(tbt2.debit_amount,0) = 0
        AND IFNULL(tbt2.ledger_name,'') IN ('', 'OTHERS')
        AND mb2.internal_flag           = 'Y'
        AND mb2.location_code           = mb1.location_code
        AND mb2.bank_id                != mb1.bank_id
  )

UNION ALL

SELECT
    '3b - intra-bank credits',
    COUNT(*)
FROM t_bank_transaction tbt
JOIN m_bank mb1 ON tbt.bank_id = mb1.bank_id
WHERE tbt.credit_amount > 0
  AND mb1.internal_flag = 'Y'
  AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS')
  AND tbt.trans_date >= '2025-04-01'
  AND EXISTS (
      SELECT 1 FROM t_bank_transaction tbt2
      JOIN m_bank mb2 ON tbt2.bank_id = mb2.bank_id
      WHERE DATE(tbt2.trans_date)        = DATE(tbt.trans_date)
        AND tbt2.debit_amount            = tbt.credit_amount
        AND IFNULL(tbt2.credit_amount,0) = 0
        AND IFNULL(tbt2.ledger_name,'')  IN ('', 'OTHERS')
        AND mb2.internal_flag            = 'Y'
        AND mb2.location_code            = mb1.location_code
        AND mb2.bank_id                 != mb1.bank_id
  )

UNION ALL

SELECT
    '3c - oil co credit mirrors',
    COUNT(*)
FROM t_bank_transaction tbt
JOIN m_bank mb ON tbt.bank_id = mb.bank_id
WHERE tbt.credit_amount > 0
  AND mb.is_oil_company = 'Y'
  AND tbt.closed_flag   = 'Y'
  AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS')
  AND tbt.trans_date    >= '2025-04-01'
  AND EXISTS (
      SELECT 1 FROM t_bank_transaction tbt2
      JOIN m_bank mb2 ON tbt2.bank_id = mb2.bank_id
      WHERE DATE(tbt2.trans_date) = DATE(tbt.trans_date)
        AND tbt2.debit_amount     = tbt.credit_amount
        AND tbt2.closed_flag      = 'Y'
        AND mb2.is_oil_company    = 'N'
        AND mb2.location_code     = mb.location_code
  );
