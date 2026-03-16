-- ============================================================
-- Fix delete_closing: accept p_deleted_by parameter
-- instead of hardcoding 'system' as the actor.
--
-- The Node controller passes req.user.username when calling
-- CALL delete_closing(closing_id, username).
-- Safe to re-run: uses DROP PROCEDURE IF EXISTS
-- ============================================================

DELIMITER //

DROP PROCEDURE IF EXISTS delete_closing //

CREATE PROCEDURE delete_closing (
    IN p_closing_id  INT,
    IN p_deleted_by  VARCHAR(45)
)
BEGIN
    DECLARE v_has_credit_bills INT DEFAULT 0;
    DECLARE v_has_cash_bills   INT DEFAULT 0;
    DECLARE v_total_bills      INT DEFAULT 0;
    DECLARE v_error_message    VARCHAR(500);
    DECLARE v_has_child_data   INT DEFAULT 0;
    DECLARE v_deleted_by       VARCHAR(45);
    DECLARE v_deletion_reason  TEXT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SET v_deleted_by = IFNULL(p_deleted_by, 'system');

    START TRANSACTION;

    -- Check if there are any credits with bills for this closing
    SELECT COUNT(*) INTO v_has_credit_bills
    FROM t_credits tc
    INNER JOIN t_bills tb ON tc.bill_id = tb.bill_id
    WHERE tc.closing_id = p_closing_id
      AND tc.bill_id IS NOT NULL
      AND tb.bill_status != 'CANCELLED';

    -- Check if there are any cash sales with bills for this closing
    SELECT COUNT(*) INTO v_has_cash_bills
    FROM t_cashsales tcs
    INNER JOIN t_bills tb ON tcs.bill_id = tb.bill_id
    WHERE tcs.closing_id = p_closing_id
      AND tcs.bill_id IS NOT NULL
      AND tb.bill_status != 'CANCELLED';

    SET v_total_bills = v_has_credit_bills + v_has_cash_bills;

    -- If bills exist, raise an error and prevent deletion
    IF v_total_bills > 0 THEN
        SET v_error_message = CONCAT('Cannot delete closing_id ', p_closing_id,
                                     '. Found ', v_total_bills,
                                     ' record(s) with active bills (',
                                     v_has_credit_bills, ' credit, ',
                                     v_has_cash_bills, ' cash). ',
                                     'Please remove or cancel the bills first.');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_error_message;
    END IF;

    -- ============================================================
    -- SMART RECYCLE BIN: Check if shift has any child data
    -- ============================================================
    SELECT (
        (SELECT COUNT(*) FROM t_reading      WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_cashsales    WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_credits      WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_expense      WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_digital_sales WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_attendance   WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_denomination WHERE closing_id = p_closing_id) +
        (SELECT COUNT(*) FROM t_2toil        WHERE closing_id = p_closing_id)
    ) INTO v_has_child_data;

    -- ============================================================
    -- Only move to recycle bin if there's actual child data
    -- ============================================================
    IF v_has_child_data > 0 THEN

        -- 1. Move closing record to deleted table
        INSERT INTO t_closing_deleted (
            closing_id, closer_id, cashier_id, location_code, cash, ex_short,
            closing_status, notes, created_by, updated_by, updation_date,
            creation_date, closing_date, close_reading_time, cashflow_id,
            deleted_by, deleted_at, deletion_reason
        )
        SELECT
            closing_id, closer_id, cashier_id, location_code, cash, ex_short,
            closing_status, notes, created_by, updated_by, updation_date,
            creation_date, closing_date, close_reading_time, cashflow_id,
            v_deleted_by, NOW(), v_deletion_reason
        FROM t_closing
        WHERE closing_id = p_closing_id;

        -- 2. Move pump readings
        IF EXISTS (SELECT 1 FROM t_reading WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_reading_deleted (
                reading_id, closing_id, opening_reading, closing_reading, pump_id,
                price, testing, created_by, updated_by, updation_date, creation_date,
                deleted_by, deleted_at
            )
            SELECT
                reading_id, closing_id, opening_reading, closing_reading, pump_id,
                price, testing, created_by, updated_by, updation_date, creation_date,
                v_deleted_by, NOW()
            FROM t_reading
            WHERE closing_id = p_closing_id;
        END IF;

        -- 3. Move cash sales
        IF EXISTS (SELECT 1 FROM t_cashsales WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_cashsales_deleted (
                cashsales_id, closing_id, Bill_no, product_id, price, price_discount,
                qty, notes, amount, created_by, updated_by, updation_date,
                creation_date, bill_id, vehicle_number, odometer_reading,
                deleted_by, deleted_at
            )
            SELECT
                cashsales_id, closing_id, Bill_no, product_id, price, price_discount,
                qty, notes, amount, created_by, updated_by, updation_date,
                creation_date, bill_id, vehicle_number, odometer_reading,
                v_deleted_by, NOW()
            FROM t_cashsales
            WHERE closing_id = p_closing_id;
        END IF;

        -- 4. Move credit sales
        IF EXISTS (SELECT 1 FROM t_credits WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_credits_deleted (
                tcredit_id, closing_id, bill_no, creditlist_id, product_id,
                price, price_discount, qty, amount, notes, created_by, updated_by,
                updation_date, creation_date, vehicle_number, indent_number,
                settlement_date, recon_id, bill_id, odometer_reading,
                deleted_by, deleted_at
            )
            SELECT
                tcredit_id, closing_id, bill_no, creditlist_id, product_id,
                price, price_discount, qty, amount, notes, created_by, updated_by,
                updation_date, creation_date, vehicle_number, indent_number,
                settlement_date, recon_id, bill_id, odometer_reading,
                v_deleted_by, NOW()
            FROM t_credits
            WHERE closing_id = p_closing_id;
        END IF;

        -- 5. Move expenses
        IF EXISTS (SELECT 1 FROM t_expense WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_expense_deleted (
                texpense_id, closing_id, expense_id, amount, creditlist_id, notes,
                created_by, updated_by, updation_date, creation_date,
                deleted_by, deleted_at
            )
            SELECT
                texpense_id, closing_id, expense_id, amount, creditlist_id, notes,
                created_by, updated_by, updation_date, creation_date,
                v_deleted_by, NOW()
            FROM t_expense
            WHERE closing_id = p_closing_id;
        END IF;

        -- 6. Move digital sales
        IF EXISTS (SELECT 1 FROM t_digital_sales WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_digital_sales_deleted (
                digital_sales_id, closing_id, vendor_id, amount, transaction_date,
                notes, created_by, updated_by, creation_date, updation_date,
                deleted_by, deleted_at
            )
            SELECT
                digital_sales_id, closing_id, vendor_id, amount, transaction_date,
                notes, created_by, updated_by, creation_date, updation_date,
                v_deleted_by, NOW()
            FROM t_digital_sales
            WHERE closing_id = p_closing_id;
        END IF;

        -- 7. Move attendance
        IF EXISTS (SELECT 1 FROM t_attendance WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_attendance_deleted (
                tattendance_id, person_id, closing_id, shift_type, in_time, out_time,
                notes, created_by, updated_by, updation_date, creation_date,
                in_date, out_date,
                deleted_by, deleted_at
            )
            SELECT
                tattendance_id, person_id, closing_id, shift_type, in_time, out_time,
                notes, created_by, updated_by, updation_date, creation_date,
                in_date, out_date,
                v_deleted_by, NOW()
            FROM t_attendance
            WHERE closing_id = p_closing_id;
        END IF;

        -- 8. Move denominations
        IF EXISTS (SELECT 1 FROM t_denomination WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_denomination_deleted (
                denom_id, denomination, denomcount, closing_id, created_by, updated_by,
                updation_date, creation_date,
                deleted_by, deleted_at
            )
            SELECT
                denom_id, denomination, denomcount, closing_id, created_by, updated_by,
                updation_date, creation_date,
                v_deleted_by, NOW()
            FROM t_denomination
            WHERE closing_id = p_closing_id;
        END IF;

        -- 9. Move 2T oil sales
        IF EXISTS (SELECT 1 FROM t_2toil WHERE closing_id = p_closing_id) THEN
            INSERT INTO t_2toil_deleted (
                oil_id, product_id, closing_id, price, given_qty, returned_qty,
                created_by, updated_by, updation_date, creation_date,
                deleted_by, deleted_at
            )
            SELECT
                oil_id, product_id, closing_id, price, given_qty, returned_qty,
                created_by, updated_by, updation_date, creation_date,
                v_deleted_by, NOW()
            FROM t_2toil
            WHERE closing_id = p_closing_id;
        END IF;

    END IF;
    -- If v_has_child_data = 0, skip recycle bin (just an empty header — hard delete)

    -- ============================================================
    -- Delete from original tables (either way)
    -- ============================================================
    DELETE FROM t_2toil          WHERE closing_id = p_closing_id;
    DELETE FROM t_credits        WHERE closing_id = p_closing_id;
    DELETE FROM t_digital_sales  WHERE closing_id = p_closing_id;
    DELETE FROM t_denomination   WHERE closing_id = p_closing_id;
    DELETE FROM t_expense        WHERE closing_id = p_closing_id;
    DELETE FROM t_cashsales      WHERE closing_id = p_closing_id;
    DELETE FROM t_reading        WHERE closing_id = p_closing_id;
    DELETE FROM t_attendance     WHERE closing_id = p_closing_id;
    DELETE FROM t_closing        WHERE closing_id = p_closing_id;

    COMMIT;

END //

DELIMITER ;
