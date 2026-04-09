ALTER TABLE t_bowser_credits
    ADD COLUMN bill_no VARCHAR(50) NULL AFTER bowser_closing_id;

SELECT 't_bowser_credits.bill_no added' AS status;
