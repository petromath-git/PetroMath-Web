-- ============================================================
-- Cashier Shift landing page: show the last N days that had shifts
-- instead of only the most recent day.
--
-- SHIFT_LIST_DEFAULT_DAYS (default 1 when not configured = old behaviour).
-- Counts days that HAVE closings, not calendar days, so a holiday gap
-- doesn't shrink the list. A manual From/To search overrides it.
--
-- Single-shift-per-day locations (e.g. PAC) set it higher; multi-shift
-- locations like SFS leave it unset.
-- ============================================================

INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
VALUES ('PAC', 'SHIFT_LIST_DEFAULT_DAYS', '7', CURDATE(), '9999-12-31', 'system', 'system', NOW(), NOW());
