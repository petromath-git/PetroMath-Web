-- GSTIN per location, as filed by the auditor (returns Apr-2025..Sep-2026).
-- MC and MC2 are one registration (Muthu Corporation I & II), so the same GSTIN must be
-- allowed on two locations: the unique keys on gstin become one plain index.
-- MC held 33AFFPC6464C1ZA (fails the check digit) because the unique key blocked the real one.

ALTER TABLE m_gst_config DROP INDEX idx_gstin, DROP INDEX m_gst_config_gstin, ADD INDEX idx_gst_config_gstin (gstin);

UPDATE m_gst_config SET gstin = '33AFFPC6464C1ZX', updated_by = 'system'
WHERE location_code = 'MC' AND gstin = '33AFFPC6464C1ZA';

INSERT INTO m_gst_config (location_code, gstin, api_provider, environment, is_active, created_by, updated_by)
SELECT 'MME', '33AAWFM4996P1Z1', 'MANUAL', 'PRODUCTION', 1, 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_gst_config WHERE location_code = 'MME');

-- Check
SELECT location_code, gstin, is_active FROM m_gst_config WHERE location_code IN ('MC', 'MC2', 'MME', 'MUE') ORDER BY location_code;
