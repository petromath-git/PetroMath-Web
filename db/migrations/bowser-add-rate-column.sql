-- Add rate column to t_bowser_closing
-- Rate is used to calculate reading amount (meter_diff * rate) for excess/shortage

ALTER TABLE t_bowser_closing
    ADD COLUMN rate DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER closing_meter;
