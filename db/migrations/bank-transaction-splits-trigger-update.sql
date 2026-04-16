-- ============================================================================
-- bank-transaction-splits-trigger-update.sql
-- ============================================================================
-- Purpose:
--   Update after_cashflow_close to handle split bank transactions.
--
--   Before this migration:
--     The trigger's receipt INSERT read all t_bank_transaction rows with
--     closed_flag = 'N' and external_source = 'CREDIT', creating one receipt
--     per bank transaction.
--
--   After this migration:
--     INSERT #1 (non-split): same as before, but adds
--       AND IFNULL(is_split, 'N') = 'N'
--     so split parent rows are skipped.
--
--     INSERT #2 (split rows): reads from t_bank_transaction_splits joined
--     to the parent (for date / bank info). One receipt per Credit split row.
--     Dedup guard uses source_split_id = s.split_id (not source_txn_id)
--     so all N split receipts are created correctly even when multiple
--     splits share the same parent t_bank_id.
--
--   Receipt creation contract (matches existing non-split pattern):
--     • cashflow_date is stamped by the existing
--         UPDATE t_receipts SET cashflow_date = NEW.cashflow_date
--         WHERE cashflow_date IS NULL ...
--       statement that already runs inside the trigger.
--     • source_txn_id  = parent t_bank_id  (unchanged, for traceability)
--     • source_split_id = split_id          (new column, for per-split dedup)
--
-- Run after: bank-transaction-splits.sql (adds source_split_id to t_receipts,
--            adds is_split to t_bank_transaction, creates t_bank_transaction_splits)
-- ============================================================================

DROP TRIGGER IF EXISTS after_cashflow_close;

DELIMITER ;;

CREATE TRIGGER `after_cashflow_close`
AFTER UPDATE ON `t_cashflow_closing`
FOR EACH ROW
BEGIN
    IF @disable_triggers IS NULL OR @disable_triggers = 0 THEN

        IF NEW.closing_status = 'CLOSED' THEN

            -- ── INSERT #1: Non-split Credit bank transactions ─────────────────
            --    Identical to the original trigger logic, with the addition of
            --    AND IFNULL(is_split, 'N') = 'N' to skip split parents.
            INSERT INTO t_receipts (
                receipt_no,
                creditlist_id,
                amount,
                receipt_date,
                receipt_type,
                location_code,
                cashflow_date,
                notes,
                created_by,
                updated_by,
                creation_date,
                updation_date,
                source_txn_id,
                source_split_id
            )
            SELECT
                COALESCE(rmax.max_receipt_no, 0) + rn.row_num AS receipt_no,
                rn.external_id,
                rn.credit_amount,
                CAST(rn.trans_date AS DATETIME)               AS receipt_date,
                'Bank Deposit',
                mb.location_code,
                NEW.cashflow_date,
                'Bank Transaction',
                'system',
                'system',
                NOW(),
                NOW(),
                rn.t_bank_id,
                NULL                                          -- not a split receipt
            FROM (
                SELECT *,
                       ROW_NUMBER() OVER (ORDER BY t_bank_id) AS row_num
                FROM t_bank_transaction
                WHERE COALESCE(closed_flag, 'N') = 'N'
                  AND external_source            = 'CREDIT'
                  AND credit_amount              > 0
                  AND IFNULL(is_split, 'N')      = 'N'        -- ← skip split parents
            ) AS rn
            JOIN m_bank mb ON rn.bank_id = mb.bank_id
            LEFT JOIN (
                SELECT MAX(receipt_no) AS max_receipt_no
                FROM t_receipts
                WHERE location_code = NEW.location_code
            ) AS rmax ON TRUE
            WHERE mb.location_code = NEW.location_code
              AND NOT EXISTS (
                  SELECT 1 FROM t_receipts r
                  WHERE r.source_txn_id = rn.t_bank_id
                    AND r.source_split_id IS NULL
              );

            -- ── INSERT #2: Split Credit allocations ───────────────────────────
            --    For each split row that is a Credit allocation and whose parent
            --    is open (closed_flag = 'N') at this location, create one receipt.
            --    Dedup guard uses source_split_id so all N splits are created even
            --    when they share the same parent t_bank_id.
            INSERT INTO t_receipts (
                receipt_no,
                creditlist_id,
                amount,
                receipt_date,
                receipt_type,
                location_code,
                cashflow_date,
                notes,
                created_by,
                updated_by,
                creation_date,
                updation_date,
                source_txn_id,
                source_split_id
            )
            SELECT
                COALESCE(rmax2.max_receipt_no, 0) + ROW_NUMBER() OVER (ORDER BY s.split_id) AS receipt_no,
                s.external_id,
                s.amount,
                CAST(tbt.trans_date AS DATETIME)                AS receipt_date,
                'Bank Deposit',
                mb.location_code,
                NEW.cashflow_date,
                CASE
                    WHEN s.remarks IS NOT NULL AND s.remarks != ''
                    THEN CONCAT('Split from Bank - ', s.remarks)
                    ELSE 'Split from Bank'
                END,
                'system',
                'system',
                NOW(),
                NOW(),
                tbt.t_bank_id,
                s.split_id
            FROM t_bank_transaction_splits s
            JOIN t_bank_transaction tbt ON s.t_bank_id = tbt.t_bank_id
            JOIN m_bank mb              ON tbt.bank_id = mb.bank_id
            LEFT JOIN (
                SELECT MAX(receipt_no) AS max_receipt_no
                FROM t_receipts
                WHERE location_code = NEW.location_code
            ) AS rmax2 ON TRUE
            WHERE mb.location_code          = NEW.location_code
              AND s.external_source         = 'CREDIT'
              AND s.amount                  > 0
              AND s.external_id             IS NOT NULL
              AND COALESCE(tbt.closed_flag, 'N') = 'N'        -- parent still open
              AND NOT EXISTS (
                  SELECT 1 FROM t_receipts r
                  WHERE r.source_split_id = s.split_id
              );

            -- ── Close all open bank transactions for this location ────────────
            UPDATE t_bank_transaction
            SET closed_flag = 'Y',
                closed_date = NEW.cashflow_date
            WHERE COALESCE(closed_flag, 'N') = 'N'
              AND bank_id IN (
                  SELECT bank_id FROM m_bank WHERE location_code = NEW.location_code
              );

            -- ── Stamp cashflow_date on all unclaimed non-cash receipts ────────
            --    This covers both non-split receipts AND split receipts that were
            --    created by INSERT #2 above (cashflow_date = NEW.cashflow_date
            --    already set in the INSERT, so this UPDATE is a no-op for them,
            --    but harmless and kept for clarity).
            UPDATE t_receipts
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code
              AND receipt_type != 'Cash';

            -- Stamp cash receipts claimed during generate_cashflow
            UPDATE t_receipts
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Stamp employee payables
            UPDATE t_employee_payable
            SET cashflow_date       = NEW.cashflow_date,
                pending_cashflow_id = NULL
            WHERE pending_cashflow_id = NEW.cashflow_id;

            -- Stamp stock receipts
            UPDATE t_tank_stk_rcpt
            SET cashflow_date = NEW.cashflow_date
            WHERE cashflow_date IS NULL
              AND location_code = NEW.location_code;

            CALL generate_closing_Stock(NEW.location_code, NEW.cashflow_date, NEW.cashflow_date);

        END IF;

    END IF;
END;;

DELIMITER ;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- After migration, confirm the trigger body contains 'is_split'.
SELECT TRIGGER_NAME, ACTION_STATEMENT
FROM INFORMATION_SCHEMA.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME   = 'after_cashflow_close';
