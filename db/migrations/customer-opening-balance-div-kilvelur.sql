-- Data fix (prod IDs): DIV KILVELUR TALUK SOCIETY had two opening balance
-- entries dated 24-Sep-2026. The opening is their sum, so they become one
-- entry and the customer's balance is unchanged.
--
--   #501  ₹12,000.00  -> ₹25,000.00 (old value kept in t_adjustments_history)
--   #550  ₹13,000.00  -> archived to t_adjustments_deleted and deleted
--
-- Run AFTER customer-opening-balance.sql (needs t_adjustments_history).
-- Each step matches the original amounts, so a re-run does nothing.

SELECT get_closing_credit_balance(1124, CURDATE()) AS kilvelur_balance_before;

INSERT INTO t_adjustments_history
SELECT NULL, a.*, 'SAKTHI', NOW(), 'Merged with #550: opening is the sum of both entries'
FROM   t_adjustments a
WHERE  a.adjustment_id = 501 AND a.location_code = 'DIV' AND a.external_id = 1124
  AND  a.adjustment_type = '201' AND a.debit_amount = 12000.00
  AND  EXISTS (SELECT 1 FROM t_adjustments b WHERE b.adjustment_id = 550 AND b.debit_amount = 13000.00);

SET @second_present = (SELECT COUNT(*) FROM t_adjustments WHERE adjustment_id = 550 AND debit_amount = 13000.00);

UPDATE t_adjustments
SET    debit_amount = 25000.00, updated_by = 'SAKTHI', updation_date = NOW()
WHERE  adjustment_id = 501 AND location_code = 'DIV' AND external_id = 1124
  AND  adjustment_type = '201' AND debit_amount = 12000.00
  AND  @second_present = 1;

INSERT INTO t_adjustments_deleted
SELECT a.*, 'SAKTHI', NOW(), 'Merged into #501: KILVELUR opening is the sum of both entries'
FROM   t_adjustments a
WHERE  a.adjustment_id = 550 AND a.location_code = 'DIV' AND a.external_id = 1124
  AND  a.adjustment_type = '201' AND a.debit_amount = 13000.00
  AND  EXISTS (SELECT 1 FROM t_adjustments b WHERE b.adjustment_id = 501 AND b.debit_amount = 25000.00);

DELETE FROM t_adjustments
WHERE  adjustment_id = 550 AND location_code = 'DIV' AND debit_amount = 13000.00
  AND  EXISTS (SELECT 1 FROM t_adjustments_deleted d WHERE d.adjustment_id = 550);

-- Verify: one entry of ₹25,000.00 and the same balance as before
SELECT adjustment_id, adjustment_date, debit_amount, description
FROM   t_adjustments
WHERE  external_source = 'CUSTOMER' AND external_id = 1124 AND adjustment_type = '201';

SELECT get_closing_credit_balance(1124, CURDATE()) AS kilvelur_balance_after;
