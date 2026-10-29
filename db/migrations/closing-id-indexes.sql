-- Migration: Add closing_id indexes for the shift ex/short calculation
--
-- CALCULATE_EXSHORTAGE(closing_id) (shift list, DSR shift summary, Day Close,
-- ex/short breakdown) sums t_2toil, t_cashsales (twice) and t_expense by
-- closing_id. None of the three had an index starting with closing_id
-- (t_2toil's unique key is (product_id, closing_id)), so every call scanned the
-- whole table. RAN's DSR (10 shifts a day) took 30-140 s on prod and starved the
-- 10-connection pool, so other pages timed out (29-Oct-2026).
--
-- Confirmed on beta: DSR shift summary for RAN 4.5 s -> 0.24 s, whole RAN DSR
-- query set ~10.9 s -> ~2.8 s. Purely additive -- does not change any value.
--
-- NOT re-runnable: plain ADD KEY (this server rejects ADD INDEX IF NOT EXISTS);
-- a second run fails with "Duplicate key name" and changes nothing.
-- Already run on beta 2026-10-29.

ALTER TABLE t_2toil
    ADD KEY idx_2toil_closing (closing_id);

ALTER TABLE t_cashsales
    ADD KEY idx_cashsales_closing (closing_id);

ALTER TABLE t_expense
    ADD KEY idx_expense_closing (closing_id);
