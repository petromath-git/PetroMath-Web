-- ============================================================
-- Day Close: enter customer cash receipts directly from Day Close
-- Generated: 2026-10-04
--
-- Why: PAC's cashier typed "Cash Receipt - MONAKARAR CHINNAPAYAN
-- 1,20,000" as a free-text Day Close line (27-Sep-2026). The cash was
-- counted but no t_receipts row existed, so the customer's balance
-- never came down. Day Close now asks for the customer on a Cash
-- Receipt line and creates the real credit receipt instead; the
-- line itself is then produced by generate_cashflow like any other
-- receipt (linked via source_table/source_id).
--
-- 1. m_account_heads.requires_credit_customer_link - 'Y' on every
--    location's "Cash Receipt" head: Day Close shows a customer picker
--    and refuses to save the line without one.
-- 2. t_receipts.origin_cashflow_id - set only on receipts entered from
--    a Day Close; deleting that Day Close deletes them too.
-- 3. delete_cashflow - deletes origin receipts (refuses if any is
--    bank-reconciled). Based on the live definition (SHOW CREATE
--    PROCEDURE on dev, 2026-10-04 - includes the cashflow_date = NULL
--    patch); only the reconciled check + origin DELETE are new.
-- 4. Catalog entry for CASH_RECEIPTS_ONLY_IN_DAYCLOSE (default N, no
--    '*' row needed - code falls back to 'N').
--
-- Plain ADD COLUMN/ADD INDEX (no IF NOT EXISTS - this server rejects
-- that syntax on ALTER TABLE). Run once per environment.
-- ============================================================

ALTER TABLE m_account_heads
    ADD COLUMN requires_credit_customer_link CHAR(1) NOT NULL DEFAULT 'N'
        COMMENT 'Y = selecting this head in Day Close shows a credit-customer picker and creates a t_receipts Cash receipt instead of a free-text line';

UPDATE m_account_heads
   SET requires_credit_customer_link = 'Y'
 WHERE account_head_name = 'Cash Receipt';

ALTER TABLE t_receipts
    ADD COLUMN origin_cashflow_id INT NULL
        COMMENT 'Day Close (t_cashflow_closing.cashflow_id) this receipt was entered from; deleted together with that Day Close',
    ADD INDEX idx_receipts_origin_cashflow (origin_cashflow_id);

DROP PROCEDURE IF EXISTS delete_cashflow;

DELIMITER $$
CREATE DEFINER=`petromath_prod`@`%` PROCEDURE `delete_cashflow`(IN p_cashflow_id INT)
BEGIN
    DECLARE v_reconciled INT DEFAULT 0;

    -- Receipts entered from this Day Close go with it - unless one is
    -- already bank-reconciled, in which case nothing is changed.
    SELECT COUNT(*) INTO v_reconciled
      FROM t_receipts
     WHERE origin_cashflow_id = p_cashflow_id
       AND (recon_match_id IS NOT NULL OR COALESCE(manual_recon_flag, 0) = 1);

    IF v_reconciled > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot delete: a cash receipt entered from this Day Close is already bank-reconciled. Remove the reconciliation first.';
    END IF;

    SET SQL_SAFE_UPDATES = 0;

    DELETE FROM t_receipts WHERE origin_cashflow_id = p_cashflow_id;

    UPDATE t_receipts          SET pending_cashflow_id = NULL,cashflow_date = NULL WHERE pending_cashflow_id = p_cashflow_id;
    UPDATE t_employee_ledger  SET pending_cashflow_id = NULL WHERE pending_cashflow_id = p_cashflow_id;

    DELETE FROM t_cashflow_closing      WHERE cashflow_id = p_cashflow_id;
    DELETE FROM t_cashflow_transaction  WHERE cashflow_id = p_cashflow_id;
    DELETE FROM t_cashflow_denomination WHERE cashflow_id = p_cashflow_id;

    UPDATE t_closing SET cashflow_id = NULL WHERE cashflow_id = p_cashflow_id;
END$$
DELIMITER ;

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
('CASH_RECEIPTS_ONLY_IN_DAYCLOSE', 'Cash credit receipts only from Day Close',
 'Y/N. When Y (and CASHFLOW_ENABLED is true), the Credit Receipts screen no longer offers the Cash receipt type - customer cash payments are entered on the Day Close screen (Cash Receipt line + customer), which creates the credit receipt. Digital and other types are unaffected, as is the shift-closing Collections tab. Default N. Checked in credit-receipt-controller.js.',
 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = 'system';
