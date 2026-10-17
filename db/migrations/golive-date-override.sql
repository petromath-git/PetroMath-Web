-- Migration: per-location go-live override (GOLIVE_DATE)
--
-- Go-live is normally the date of the location's first shift. Some locations
-- have real bank / SAP activity before sales start (SPFP: SAP loads and
-- deposits from 31-Mar-2025, first shift 23-Nov-2025), and the go-live guard
-- rejected those statement lines.
--
-- GOLIVE_DATE (m_location_config, location row only, YYYY-MM-DD) moves go-live
-- EARLIER than the first shift. A value later than the first shift is ignored,
-- so a typo can never block entries that already belong after go-live.
--
-- Only get_location_golive_date() changes; the receipt / bank / adjustment
-- triggers and the app (locationDao.getGoLiveDate calls this function) follow
-- it. Opening Balance Entries still sit on the day before the first shift
-- (get_location_first_shift_date is unchanged).


DROP FUNCTION IF EXISTS get_location_golive_date;

DELIMITER $$

CREATE FUNCTION get_location_golive_date(p_location_code VARCHAR(50))
RETURNS DATE
READS SQL DATA
BEGIN
    DECLARE v_golive   DATE;
    DECLARE v_override DATE;

    SELECT DATE(MIN(closing_date)) INTO v_golive
    FROM   t_closing
    WHERE  location_code = p_location_code;

    IF v_golive IS NULL THEN
        SELECT MIN(DATE(start_date)) INTO v_golive
        FROM   m_location
        WHERE  location_code = p_location_code
          AND  start_date > '1971-01-01';   -- ignore unset/zero dates
    END IF;

    -- Per-location override; only ever moves go-live earlier
    SELECT STR_TO_DATE(MAX(setting_value), '%Y-%m-%d') INTO v_override
    FROM   m_location_config
    WHERE  location_code = p_location_code
      AND  setting_name  = 'GOLIVE_DATE'
      AND  CURDATE() BETWEEN effective_start_date AND effective_end_date;

    IF v_override IS NOT NULL AND (v_golive IS NULL OR v_override < v_golive) THEN
        SET v_golive = v_override;
    END IF;

    RETURN v_golive;
END$$

DELIMITER ;


-- ── Location Config screen catalog entry ──────────────────────────────────

INSERT INTO m_location_config_catalog
    (setting_name, short_description, detailed_description, value_type, created_by, updated_by)
SELECT 'GOLIVE_DATE',
       'Go-live date override (YYYY-MM-DD)',
       'Earliest date allowed for bank / SAP statement lines, receipts and adjustments. Normally the first shift date; set this to allow entries from an earlier date (e.g. SAP loads before sales started). Only an earlier date than the first shift takes effect.',
       'TEXT', 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_location_config_catalog WHERE setting_name = 'GOLIVE_DATE');


-- ── SPFP: allow bank / SAP entries before the 23-Nov-2025 first shift ─────
-- Set the date you want, then run:
--
-- INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
-- VALUES ('SPFP', 'GOLIVE_DATE', '2025-03-31', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());


-- Verify
SELECT get_location_golive_date('SPFP') AS spfp_golive;
