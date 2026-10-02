-- ============================================================
-- Platform billing: per-location billing timing (ADVANCE / ARREARS)
--
-- ARREARS — invoice raised after the month ends, for the month that
--           just ended (older parties, billed this way historically)
-- ADVANCE — invoice raised at the start of the month, for the
--           current month (newer parties)
--
-- Lives on the effective-dated billing plan, so a location can switch
-- timing from a given date and older invoices are unaffected.
-- Every existing plan becomes ARREARS (how the auto-generation behaved
-- until now) — switch individual locations to ADVANCE from the
-- Billing Plans page.
--
-- NOT re-runnable (plain ADD COLUMN — IF NOT EXISTS fails on this server).
-- ============================================================

ALTER TABLE m_location_billing_plan
    ADD COLUMN billing_timing VARCHAR(10) NOT NULL DEFAULT 'ARREARS' AFTER plan_duration_months;

-- BAF has been billed in advance from the start
UPDATE m_location_billing_plan
   SET billing_timing = 'ADVANCE'
 WHERE location_code = 'BAF';

-- ── Verify ───────────────────────────────────────────────────────────
SELECT location_code, billing_timing, plan_duration_months, effective_start_date, effective_end_date
FROM m_location_billing_plan
ORDER BY location_code, effective_start_date;
