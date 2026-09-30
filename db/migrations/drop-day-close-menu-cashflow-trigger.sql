-- ============================================================
-- Drop the Day Close menu -> CASHFLOW_ENABLED auto-sync
-- Generated: 2026-09-30
--
-- trg_day_close_menu_enable_cashflow_ins/_upd on m_menu_access_override
-- and enable_cashflow_for_day_close were applied to dev and prod on
-- 2026-09-29 (never committed). Replaced by a gate in generate_cashflow
-- plus a check in cash-flow-controller.triggerCashSalesByDate: Day
-- Close refuses to generate when CASHFLOW_ENABLED is not 'true',
-- instead of a side-effect trigger on the shared menu tables.
--
-- CASHFLOW_ENABLED rows created meanwhile stay: they are correct
-- (dev: DIV/SMA 'backfill'; prod: none created by the trigger).
-- Safe to re-run.
-- ============================================================

DROP TRIGGER IF EXISTS trg_day_close_menu_enable_cashflow_ins;
DROP TRIGGER IF EXISTS trg_day_close_menu_enable_cashflow_upd;
DROP PROCEDURE IF EXISTS enable_cashflow_for_day_close;
