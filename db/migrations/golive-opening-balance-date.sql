-- Migration: opening balances must be dated the day before go-live
--
-- Follows golive-date-guard.sql, which exempted Opening Balance Entry
-- (adjustment_type 201) from the go-live check entirely, so one could be dated
-- any day before go-live (e.g. PAC 04-Sep for a 07-Sep first shift).
--
-- New rule for t_adjustments:
--   * Opening Balance Entry dated before the first shift must be dated exactly
--     the day before the first shift. With no shift yet (onboarding) any date
--     is allowed, since go-live isn't known.
--   * Everything else: not before go-live (unchanged).
-- Existing rows are untouched: UPDATE only checks when date/location/type change.

DROP FUNCTION IF EXISTS get_location_first_shift_date;

DELIMITER $$

CREATE FUNCTION get_location_first_shift_date(p_location_code VARCHAR(50))
RETURNS DATE
READS SQL DATA
BEGIN
    DECLARE v_first DATE;

    SELECT DATE(MIN(closing_date)) INTO v_first
    FROM   t_closing
    WHERE  location_code = p_location_code;

    RETURN v_first;
END$$

DELIMITER ;


DROP TRIGGER IF EXISTS trg_adjustments_golive_insert;
DROP TRIGGER IF EXISTS trg_adjustments_golive_update;
DROP PROCEDURE IF EXISTS check_adjustment_golive;

DELIMITER $$

-- Shared by the insert and update triggers; SIGNALs if the row breaks the rule
CREATE PROCEDURE check_adjustment_golive(
    p_location_code   VARCHAR(50),
    p_adjustment_type VARCHAR(100),
    p_adjustment_date DATE
)
READS SQL DATA
BEGIN
    DECLARE v_first  DATE;
    DECLARE v_golive DATE;
    DECLARE v_msg    VARCHAR(255);

    IF p_adjustment_type <=> '201' THEN
        SET v_first = get_location_first_shift_date(p_location_code);

        IF v_first IS NOT NULL
           AND p_adjustment_date < v_first
           AND p_adjustment_date <> DATE_SUB(v_first, INTERVAL 1 DAY) THEN
            SET v_msg = CONCAT('Opening balances must be dated ',
                               DATE_FORMAT(DATE_SUB(v_first, INTERVAL 1 DAY), '%d-%b-%Y'),
                               ', the day before this location''s PetroMath go-live (',
                               DATE_FORMAT(v_first, '%d-%b-%Y'), ').');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    ELSE
        SET v_golive = get_location_golive_date(p_location_code);

        IF v_golive IS NOT NULL AND p_adjustment_date < v_golive THEN
            SET v_msg = CONCAT('Adjustment date ', DATE_FORMAT(p_adjustment_date, '%d-%b-%Y'),
                               ' is before this location''s PetroMath go-live date (',
                               DATE_FORMAT(v_golive, '%d-%b-%Y'),
                               '). Use an Opening Balance Entry for balances before go-live.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_adjustments_golive_insert
BEFORE INSERT ON t_adjustments
FOR EACH ROW
BEGIN
    CALL check_adjustment_golive(NEW.location_code, NEW.adjustment_type, NEW.adjustment_date);
END$$

CREATE TRIGGER trg_adjustments_golive_update
BEFORE UPDATE ON t_adjustments
FOR EACH ROW
BEGIN
    IF NOT (NEW.adjustment_date <=> OLD.adjustment_date)
    OR NOT (NEW.location_code   <=> OLD.location_code)
    OR NOT (NEW.adjustment_type <=> OLD.adjustment_type) THEN
        CALL check_adjustment_golive(NEW.location_code, NEW.adjustment_type, NEW.adjustment_date);
    END IF;
END$$

DELIMITER ;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Opening balances already dated other than the day before first shift (left as-is)
SELECT a.location_code, a.adjustment_id, a.adjustment_date,
       DATE_SUB(get_location_first_shift_date(a.location_code), INTERVAL 1 DAY) AS expected_date
FROM   t_adjustments a
WHERE  a.adjustment_type = '201'
  AND  get_location_first_shift_date(a.location_code) IS NOT NULL
  AND  a.adjustment_date < get_location_first_shift_date(a.location_code)
  AND  a.adjustment_date <> DATE_SUB(get_location_first_shift_date(a.location_code), INTERVAL 1 DAY)
ORDER  BY a.location_code, a.adjustment_date;

SELECT trigger_name, action_timing, event_manipulation
FROM   information_schema.triggers
WHERE  trigger_schema = DATABASE() AND trigger_name LIKE 'trg_adjustments_golive%';
