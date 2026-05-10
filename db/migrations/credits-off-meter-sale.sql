-- Migration: add off_meter_sale flag to t_credits
-- Purpose: distinguish metered credit sales (went through the pump dispenser)
--          from off-meter credit sales (physical barrel/bulk handover, not metered).
--          The day bill procedure excludes off_meter_sale = 1 rows when deducting
--          credits from pump readings, so barrel sales do not cause a floor error.
-- Run on: all environments (dev, prod)

ALTER TABLE t_credits
ADD COLUMN off_meter_sale TINYINT(1) NOT NULL DEFAULT 0;
