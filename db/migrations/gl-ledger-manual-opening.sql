-- GL_LEDGER_MANUAL_OPENING (default N)
-- Ledger Report (/gl/ledger) shows an "Opening Balance (manual)" box. A figure
-- typed there (e.g. the SAP / bank statement opening) replaces the system
-- opening for that view only, and the running + closing balance follow from
-- it, so the closing can be matched against the statement for the auditor.
-- Nothing is saved. Code-only switch: no schema change.
--
-- Enabled for MC (copy the block for other locations):
INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by)
SELECT 'MC', 'GL_LEDGER_MANUAL_OPENING', 'Y', CURDATE(), '9999-12-31', 'MIGRATION', 'MIGRATION'
WHERE NOT EXISTS (
    SELECT 1 FROM m_location_config
    WHERE location_code = 'MC' AND setting_name = 'GL_LEDGER_MANUAL_OPENING'
);
