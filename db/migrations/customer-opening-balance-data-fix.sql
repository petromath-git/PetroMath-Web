-- Data fix (prod IDs; beta is a copy of prod): Opening Balance Entry clean-up
-- before Customer Master takes over customer opening balances. Run BEFORE
-- customer-opening-balance.sql.
--
-- A. Customer adjustments booked as Opening Balance Entry (201) that are really
--    ordinary corrections -> General Adjustment (208). Same amount and date,
--    so customer balances do not change; only the GL ledger does (Opening
--    Balance Equity -> General Adjustment) once GL Control is re-run.
-- B. BAF GREEN MOUNT CCMS had two opening entries; owner confirmed ₹43,980
--    (#413). #540 (₹43,840 "Balance C/F") is archived to
--    t_adjustments_deleted and deleted — the customer's balance drops by
--    ₹43,840.
--
-- Each statement also matches location, type and amount so it does nothing
-- if a row has already been changed.

-- ── A. 201 -> 208 ───────────────────────────────────────────────────────────

UPDATE t_adjustments
SET    adjustment_type = '208', updated_by = 'SAKTHI', updation_date = NOW()
WHERE  adjustment_type = '201' AND external_source = 'CUSTOMER'
  AND  ( (adjustment_id = 259 AND location_code = 'MUE' AND credit_amount = 305.55)
      OR (adjustment_id = 488 AND location_code = 'SFS' AND credit_amount = 37.11)
      OR (adjustment_id = 223 AND location_code = 'SFS' AND debit_amount  = 55662.00)
      OR (adjustment_id = 222 AND location_code = 'SFS' AND credit_amount = 55662.00)
      OR (adjustment_id = 245 AND location_code = 'SFS' AND debit_amount  = 4157.02)
      OR (adjustment_id = 224 AND location_code = 'SFS' AND credit_amount = 50000.00)
      OR (adjustment_id = 287 AND location_code = 'SFS' AND debit_amount  = 5574.83) );

SELECT ROW_COUNT() AS reclassified_to_208;   -- expect 7


-- ── B. BAF GREEN MOUNT CCMS: drop the second opening entry ────────────────

INSERT INTO t_adjustments_deleted
SELECT a.*, 'SAKTHI', NOW(), 'Duplicate opening balance; owner confirmed ₹43,980 (#413)'
FROM   t_adjustments a
WHERE  a.adjustment_id = 540 AND a.location_code = 'BAF'
  AND  a.adjustment_type = '201' AND a.debit_amount = 43840.00;

DELETE FROM t_adjustments
WHERE  adjustment_id = 540 AND location_code = 'BAF'
  AND  adjustment_type = '201' AND debit_amount = 43840.00
  AND  EXISTS (SELECT 1 FROM t_adjustments_deleted d WHERE d.adjustment_id = 540);

SELECT ROW_COUNT() AS baf_deleted;           -- expect 1


-- ── Verify ─────────────────────────────────────────────────────────────────
SELECT adjustment_id, location_code, adjustment_type, debit_amount, credit_amount, description
FROM   t_adjustments
WHERE  adjustment_id IN (259, 488, 223, 222, 245, 224, 287, 413, 540)
ORDER  BY adjustment_id;
