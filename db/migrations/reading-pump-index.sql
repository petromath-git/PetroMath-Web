-- Migration: Add (pump_id, closing_reading) index on t_reading
--
-- The DSR's skipped-readings check (getSkippedReadings, shown where
-- SHOW_SKIPPED_READING_DSR = Y) looks up each pump's earlier readings by
-- pump_id and closing_reading. t_reading had no index starting with pump_id,
-- so every check scanned all ~197k readings (21-26 s for RAN on prod,
-- 29-Oct-2026). Purely additive -- does not change any value.
--
-- NOT re-runnable: plain ADD KEY (this server rejects ADD INDEX IF NOT EXISTS);
-- a second run fails with "Duplicate key name" and changes nothing.

ALTER TABLE t_reading
    ADD KEY idx_reading_pump_closing (pump_id, closing_reading);
