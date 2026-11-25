-- ============================================================================
-- IOCL Invoices email import: recipient GSTIN on the log (tkt #484)
--
-- A PDF refused because two bunks share a GSTIN has no location_code, so the
-- bunks could not see it. With the GSTIN on the row, both bunks see it.
-- Run BEFORE deploying the code. Safe to re-run.
-- ============================================================================
DROP PROCEDURE IF EXISTS tmp_oil_email_gstin;
DELIMITER //
CREATE PROCEDURE tmp_oil_email_gstin()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 't_oil_invoice_email_log' AND COLUMN_NAME = 'recipient_gstin') THEN
        ALTER TABLE t_oil_invoice_email_log
            ADD COLUMN recipient_gstin VARCHAR(15) NULL COMMENT 'GSTIN the invoice is made out to (refused PDFs)' AFTER invoice_id;
    END IF;
END //
DELIMITER ;
CALL tmp_oil_email_gstin();
DROP PROCEDURE IF EXISTS tmp_oil_email_gstin;

-- rows refused before this column existed
UPDATE t_oil_invoice_email_log
SET recipient_gstin = REGEXP_SUBSTR(detail, '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]')
WHERE status = 'BLOCKED' AND location_code IS NULL AND recipient_gstin IS NULL AND detail LIKE '%share GSTIN %';

SELECT status, location_code, recipient_gstin, COUNT(*) FROM t_oil_invoice_email_log GROUP BY 1, 2, 3;
