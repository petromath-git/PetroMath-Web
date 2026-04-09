-- Add ex_shortage column to t_bowser_closing
-- Stored when closing is finalized: (credit + digital + cash) - reading_amount

ALTER TABLE t_bowser_closing
    ADD COLUMN ex_shortage DECIMAL(10,2) NULL AFTER rate;
