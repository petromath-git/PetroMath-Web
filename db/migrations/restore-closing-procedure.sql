-- ============================================================
-- Restore Closing Stored Procedure
-- Mirrors delete_closing in reverse — moves data back from
-- all *_deleted recycle bin tables to their live counterparts.
--
-- Usage: CALL restore_closing(p_deleted_record_id, 'USERNAME');
-- Safe to re-run: uses DROP PROCEDURE IF EXISTS
-- ============================================================

DELIMITER //

DROP PROCEDURE IF EXISTS restore_closing //

CREATE PROCEDURE restore_closing (
    IN p_deleted_record_id INT,
    IN p_restored_by       VARCHAR(45)
)
BEGIN
    DECLARE v_closing_id          INT;
    DECLARE v_location_code       VARCHAR(50);
    DECLARE v_closing_date        TIMESTAMP;
    DECLARE v_already_exists      INT DEFAULT 0;
    DECLARE v_cashflow_closed     INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Resolve closing_id, location and date from the audit record
    SELECT closing_id, location_code, closing_date
    INTO v_closing_id, v_location_code, v_closing_date
    FROM t_closing_deleted
    WHERE deleted_record_id = p_deleted_record_id;

    IF v_closing_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Deleted record not found. It may have already been restored or does not exist.';
    END IF;

    -- Guard: prevent restoring if closing_id already exists in live table
    SELECT COUNT(*) INTO v_already_exists
    FROM t_closing
    WHERE closing_id = v_closing_id;

    IF v_already_exists > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot restore — a shift with this closing_id already exists in the live table.';
    END IF;

    -- Guard: for cashflow-enabled locations, block restore if cashflow for
    -- that date is already CLOSED (data would be orphaned outside the cashflow).
    SELECT COUNT(*) INTO v_cashflow_closed
    FROM t_cashflow_closing
    WHERE location_code   = v_location_code
      AND cashflow_date   = DATE(v_closing_date)
      AND closing_status  = 'CLOSED';

    IF v_cashflow_closed > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot restore — the cashflow for this shift\'s date is already closed. Reopen the cashflow first.';
    END IF;

    -- ── 1. Restore closing header ──────────────────────────────
    INSERT INTO t_closing (
        closing_id, closer_id, cashier_id, location_code, cash, ex_short,
        closing_status, notes, created_by, updated_by, updation_date,
        creation_date, closing_date, close_reading_time, cashflow_id
        -- credit_billing_stopped omitted: defaults to 0
    )
    SELECT
        closing_id, closer_id, cashier_id, location_code, cash, ex_short,
        closing_status, notes, created_by, p_restored_by, NOW(),
        creation_date, closing_date, close_reading_time, cashflow_id
    FROM t_closing_deleted
    WHERE deleted_record_id = p_deleted_record_id;

    -- ── 2. Restore pump readings ───────────────────────────────
    IF EXISTS (SELECT 1 FROM t_reading_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_reading (
            reading_id, closing_id, opening_reading, closing_reading, pump_id,
            price, testing, created_by, updated_by, updation_date, creation_date
        )
        SELECT
            reading_id, closing_id, opening_reading, closing_reading, pump_id,
            price, testing, created_by, p_restored_by, NOW(), creation_date
        FROM t_reading_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 3. Restore cash sales ──────────────────────────────────
    IF EXISTS (SELECT 1 FROM t_cashsales_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_cashsales (
            cashsales_id, closing_id, Bill_no, product_id, price, price_discount,
            qty, notes, amount, created_by, updated_by, updation_date,
            creation_date, bill_id, vehicle_number, odometer_reading
        )
        SELECT
            cashsales_id, closing_id, Bill_no, product_id, price, price_discount,
            qty, notes, amount, created_by, p_restored_by, NOW(),
            creation_date, bill_id, vehicle_number, odometer_reading
        FROM t_cashsales_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 4. Restore credit sales ────────────────────────────────
    IF EXISTS (SELECT 1 FROM t_credits_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_credits (
            tcredit_id, closing_id, bill_no, creditlist_id, product_id,
            price, price_discount, qty, amount, notes, created_by, updated_by,
            updation_date, creation_date, vehicle_number, indent_number,
            settlement_date, recon_id, bill_id, odometer_reading
        )
        SELECT
            tcredit_id, closing_id, bill_no, creditlist_id, product_id,
            price, price_discount, qty, amount, notes, created_by, p_restored_by,
            NOW(), creation_date, vehicle_number, indent_number,
            settlement_date, recon_id, bill_id, odometer_reading
        FROM t_credits_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 5. Restore expenses ────────────────────────────────────
    IF EXISTS (SELECT 1 FROM t_expense_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_expense (
            texpense_id, closing_id, expense_id, amount, creditlist_id, notes,
            created_by, updated_by, updation_date, creation_date
        )
        SELECT
            texpense_id, closing_id, expense_id, amount, creditlist_id, notes,
            created_by, p_restored_by, NOW(), creation_date
        FROM t_expense_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 6. Restore digital sales ───────────────────────────────
    IF EXISTS (SELECT 1 FROM t_digital_sales_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_digital_sales (
            digital_sales_id, closing_id, vendor_id, amount, transaction_date,
            notes, created_by, updated_by, creation_date, updation_date
        )
        SELECT
            digital_sales_id, closing_id, vendor_id, amount, transaction_date,
            notes, created_by, p_restored_by, creation_date, NOW()
        FROM t_digital_sales_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 7. Restore attendance ──────────────────────────────────
    IF EXISTS (SELECT 1 FROM t_attendance_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_attendance (
            tattendance_id, person_id, closing_id, shift_type, in_time, out_time,
            notes, created_by, updated_by, updation_date, creation_date,
            in_date, out_date
        )
        SELECT
            tattendance_id, person_id, closing_id, shift_type, in_time, out_time,
            notes, created_by, p_restored_by, NOW(), creation_date,
            in_date, out_date
        FROM t_attendance_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 8. Restore denominations ───────────────────────────────
    IF EXISTS (SELECT 1 FROM t_denomination_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_denomination (
            denom_id, denomination, denomcount, closing_id, created_by, updated_by,
            updation_date, creation_date
        )
        SELECT
            denom_id, denomination, denomcount, closing_id, created_by, p_restored_by,
            NOW(), creation_date
        FROM t_denomination_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── 9. Restore 2T oil sales ────────────────────────────────
    IF EXISTS (SELECT 1 FROM t_2toil_deleted WHERE closing_id = v_closing_id) THEN
        INSERT INTO t_2toil (
            oil_id, product_id, closing_id, price, given_qty, returned_qty,
            created_by, updated_by, updation_date, creation_date
        )
        SELECT
            oil_id, product_id, closing_id, price, given_qty, returned_qty,
            created_by, p_restored_by, NOW(), creation_date
        FROM t_2toil_deleted
        WHERE closing_id = v_closing_id;
    END IF;

    -- ── Cleanup recycle bin ────────────────────────────────────
    DELETE FROM t_reading_deleted      WHERE closing_id = v_closing_id;
    DELETE FROM t_cashsales_deleted    WHERE closing_id = v_closing_id;
    DELETE FROM t_credits_deleted      WHERE closing_id = v_closing_id;
    DELETE FROM t_expense_deleted      WHERE closing_id = v_closing_id;
    DELETE FROM t_digital_sales_deleted WHERE closing_id = v_closing_id;
    DELETE FROM t_attendance_deleted   WHERE closing_id = v_closing_id;
    DELETE FROM t_denomination_deleted WHERE closing_id = v_closing_id;
    DELETE FROM t_2toil_deleted        WHERE closing_id = v_closing_id;
    DELETE FROM t_closing_deleted      WHERE deleted_record_id = p_deleted_record_id;

    COMMIT;

END //

DELIMITER ;
