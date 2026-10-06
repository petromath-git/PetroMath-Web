-- Cashflow lines on an Account Head with allowed_entry_type='BOTH' (the
-- Account Heads screen default) were saved with entry_type NULL, which hides
-- them from the Day Close page and the Daily Sales Report and leaves them out
-- of the closing balance. Hit at SMA 04/05-OCT-2026 (RAJ MOHAN-PERSONAL).
--
-- The Day Close page now sends entry_type from the side the row was entered
-- on (Inflow = CREDIT, Outflow = DEBIT). The INSERT trigger already keeps a
-- supplied entry_type. This UPDATE trigger used to overwrite it with NULL when
-- the type changed to a BOTH head; now it keeps the existing/supplied value
-- unless the head (or the system-type fallback) gives a direction.

DROP TRIGGER IF EXISTS trg_cashflow_txn_account_head_update;

DELIMITER $$

CREATE TRIGGER trg_cashflow_txn_account_head_update
BEFORE UPDATE ON t_cashflow_transaction
FOR EACH ROW
BEGIN
    DECLARE v_location_code VARCHAR(50);

    IF NOT (OLD.type <=> NEW.type) THEN
        SELECT location_code INTO v_location_code
        FROM t_cashflow_closing WHERE cashflow_id = NEW.cashflow_id;

        IF v_location_code IS NOT NULL THEN
            SET @v_ah = NULL;
            SELECT account_head_id INTO @v_ah
            FROM m_account_heads
            WHERE location_code = v_location_code AND account_head_name = NEW.type
            LIMIT 1;
            SET NEW.account_head_id = @v_ah;

            SET @v_et = NULL;
            SELECT CASE allowed_entry_type WHEN 'BOTH' THEN NULL ELSE allowed_entry_type END INTO @v_et
            FROM m_account_heads
            WHERE account_head_id = @v_ah;

            IF @v_et IS NULL THEN
                SET @v_et = CASE NEW.type
                    WHEN 'Balance B/F' THEN 'CREDIT'
                    WHEN 'Collection' THEN 'CREDIT'
                    WHEN '2T Oil' THEN 'CREDIT'
                    WHEN 'Discount' THEN 'DEBIT'
                    WHEN 'Cashier A/C (+)' THEN 'CREDIT'
                    WHEN 'Cashier A/C (-)' THEN 'DEBIT'
                    WHEN 'Cash Receipt' THEN 'CREDIT'
                    WHEN 'Expense' THEN 'DEBIT'
                    WHEN 'Salary Payout' THEN 'DEBIT'
                    WHEN 'Salary Recovery' THEN 'CREDIT'
                    ELSE NULL
                END;
            END IF;
            SET NEW.entry_type = COALESCE(@v_et, NEW.entry_type);
        END IF;
    END IF;
END$$

DELIMITER ;
