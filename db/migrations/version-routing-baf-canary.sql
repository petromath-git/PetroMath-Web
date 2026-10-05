-- ============================================================
-- Version routing: give Balaa Fuels (BAF) access to beta (canary)
-- Generated: 2026-10-05
--
-- On the beta app (APP_VERSION=canary) utils/version-routing.js
-- only lets a location in when m_version_routing has an active
-- 'canary' row for it. This adds that row for BAF.
--
-- Run against the database the beta app uses.
-- Guarded with NOT EXISTS, safe to re-run.
-- ============================================================

INSERT INTO m_version_routing (location_code, app_version, effective_start_date, effective_end_date)
SELECT 'BAF', 'canary', NOW(), NULL
WHERE NOT EXISTS (
    SELECT 1 FROM m_version_routing
    WHERE location_code = 'BAF'
      AND app_version = 'canary'
      AND effective_start_date <= NOW()
      AND (effective_end_date IS NULL OR effective_end_date > NOW())
);

-- Verify (should return 'canary'):
-- SELECT app_version FROM m_version_routing
-- WHERE location_code = 'BAF'
--   AND effective_start_date <= NOW()
--   AND (effective_end_date IS NULL OR effective_end_date > NOW())
-- ORDER BY effective_start_date DESC LIMIT 1;
