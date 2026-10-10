-- Data fix (prod IDs): DIV KEYEM INFRA PROJECTS PVT LTD had two opening
-- balance entries dated 24-Sep-2026. The location confirmed the opening is
-- their sum, so they become one entry and the customer's balance is unchanged.
--
--   #499  ₹11,167.27  -> ₹24,585.16 (old value kept in t_adjustments_history)
--   #538  ₹13,417.89  -> archived to t_adjustments_deleted and deleted
--
-- Run AFTER customer-opening-balance.sql (needs t_adjustments_history).
-- Each step matches the original amounts, so a re-run does nothing.

SELECT get_closing_credit_balance(1122, CURDATE()) AS keyem_balance_before;

INSERT INTO t_adjustments_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged with #538: opening is the sum of both entries'
FROM   t_adjustments a
WHERE  a.adjustment_id = 499 AND a.location_code = 'DIV' AND a.external_id = 1122
  AND  a.adjustment_type = '201' AND a.debit_amount = 11167.27
  AND  EXISTS (SELECT 1 FROM t_adjustments b WHERE b.adjustment_id = 538 AND b.debit_amount = 13417.89);

SET @second_present = (SELECT COUNT(*) FROM t_adjustments WHERE adjustment_id = 538 AND debit_amount = 13417.89);

UPDATE t_adjustments
SET    debit_amount = 24585.16, updated_by = 'SAKTHI', updation_date = NOW()
WHERE  adjustment_id = 499 AND location_code = 'DIV' AND external_id = 1122
  AND  adjustment_type = '201' AND debit_amount = 11167.27
  AND  @second_present = 1;

INSERT INTO t_adjustments_deleted
SELECT a.*, 'SAKTHI', NOW(), 'Merged into #499: KEYEM opening is the sum of both entries'
FROM   t_adjustments a
WHERE  a.adjustment_id = 538 AND a.location_code = 'DIV' AND a.external_id = 1122
  AND  a.adjustment_type = '201' AND a.debit_amount = 13417.89
  AND  EXISTS (SELECT 1 FROM t_adjustments b WHERE b.adjustment_id = 499 AND b.debit_amount = 24585.16);

DELETE FROM t_adjustments
WHERE  adjustment_id = 538 AND location_code = 'DIV' AND debit_amount = 13417.89
  AND  EXISTS (SELECT 1 FROM t_adjustments_deleted d WHERE d.adjustment_id = 538);

-- Verify: one entry of ₹24,585.16 and the same balance as before
SELECT adjustment_id, adjustment_date, debit_amount, description
FROM   t_adjustments
WHERE  external_source = 'CUSTOMER' AND external_id = 1122 AND adjustment_type = '201';

SELECT get_closing_credit_balance(1122, CURDATE()) AS keyem_balance_after;
