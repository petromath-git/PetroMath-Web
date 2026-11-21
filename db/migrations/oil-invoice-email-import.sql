-- ============================================================================
-- IOCL Invoices: import from email (tkt #484)
--
-- IOCL emails its invoices to each bunk. The bunk auto-forwards them to a Gmail
-- mailbox; PetroMath reads that mailbox over IMAP (Gmail App Password), takes
-- every PDF that is an IOCL charge invoice, works out the bunk from the
-- recipient GSTIN and saves it exactly as an upload on /oil-invoices would.
--
-- 1. m_oil_invoice_mailbox           — one row per email address. The App
--                                       Password is AES-256-GCM encrypted with
--                                       PORTAL_CRED_KEY (.env), never stored plain.
-- 2. m_oil_invoice_mailbox_location  — the bunks a mailbox may import for
--                                       (one mailbox can serve several bunks).
-- 3. t_oil_invoice_email_log         — one row per PDF attachment read, so a
--                                       mail is never imported twice and the
--                                       user sees what happened to each PDF.
--
-- Two ways a mailbox reaches PetroMath (access_mode):
--   SCRIPT  a Google Apps Script inside the Gmail account posts each new PDF
--           to /oil-invoices/inbound with the mailbox's key (only its SHA-256
--           is stored). No Gmail password anywhere — the default.
--   IMAP    PetroMath logs in with an App Password and reads the mailbox.
--
-- No menu change: it is a tab on /oil-invoices (menu OIL_CO_INVOICES).
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_oil_invoice_mailbox (
    mailbox_id          INT           NOT NULL AUTO_INCREMENT,
    email_address       VARCHAR(150)  NOT NULL,
    imap_host           VARCHAR(100)  NOT NULL DEFAULT 'imap.gmail.com',
    imap_port           INT           NOT NULL DEFAULT 993,
    access_mode         VARCHAR(10)   NOT NULL DEFAULT 'SCRIPT' COMMENT 'SCRIPT (Google Apps Script posts the PDFs) / IMAP (App Password)',
    password_enc        VARCHAR(500)  NULL COMMENT 'IMAP: App Password, utils/secret-box (PORTAL_CRED_KEY)',
    token_hash          CHAR(64)      NULL COMMENT 'SCRIPT: SHA-256 of the key in the Google script',
    lookback_days       INT           NOT NULL DEFAULT 30 COMMENT 'mails older than this are not read',
    active_flag         CHAR(1)       NOT NULL DEFAULT 'Y',
    last_run_at         DATETIME      NULL,
    last_status         VARCHAR(20)   NULL COMMENT 'OK / LOGIN_FAILED (scheduler pauses until the password is saved again) / ERROR',
    last_message        VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (mailbox_id),
    UNIQUE KEY uniq_oil_mailbox_email (email_address),
    UNIQUE KEY uniq_oil_mailbox_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Upgrade a table created by the first version of this file (IMAP only, beta 21-Nov-2026)
DROP PROCEDURE IF EXISTS tmp_oil_mailbox_upgrade;
DELIMITER //
CREATE PROCEDURE tmp_oil_mailbox_upgrade()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'm_oil_invoice_mailbox' AND COLUMN_NAME = 'access_mode') THEN
        ALTER TABLE m_oil_invoice_mailbox
            ADD COLUMN access_mode VARCHAR(10) NOT NULL DEFAULT 'SCRIPT' COMMENT 'SCRIPT (Google Apps Script posts the PDFs) / IMAP (App Password)' AFTER imap_port,
            ADD COLUMN token_hash CHAR(64) NULL COMMENT 'SCRIPT: SHA-256 of the key in the Google script' AFTER password_enc,
            MODIFY COLUMN password_enc VARCHAR(500) NULL COMMENT 'IMAP: App Password, utils/secret-box (PORTAL_CRED_KEY)',
            ADD UNIQUE KEY uniq_oil_mailbox_token (token_hash);
        UPDATE m_oil_invoice_mailbox SET access_mode = 'IMAP' WHERE password_enc IS NOT NULL;
    END IF;
END //
DELIMITER ;
CALL tmp_oil_mailbox_upgrade();
DROP PROCEDURE IF EXISTS tmp_oil_mailbox_upgrade;

CREATE TABLE IF NOT EXISTS m_oil_invoice_mailbox_location (
    mailbox_id          INT           NOT NULL,
    location_code       VARCHAR(50)   NOT NULL,
    created_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mailbox_id, location_code),
    KEY idx_oil_mailbox_loc (location_code),
    CONSTRAINT fk_oil_mailbox_loc FOREIGN KEY (mailbox_id) REFERENCES m_oil_invoice_mailbox (mailbox_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_oil_invoice_email_log (
    log_id              INT           NOT NULL AUTO_INCREMENT,
    mailbox_id          INT           NOT NULL,
    message_key         VARCHAR(255)  NOT NULL COMMENT 'Message-ID header (or uidvalidity:uid when missing)',
    part_id             VARCHAR(30)   NOT NULL COMMENT 'IMAP body part of the attachment',
    mail_date           DATETIME      NULL,
    mail_from           VARCHAR(200)  NULL,
    subject             VARCHAR(300)  NULL,
    file_name           VARCHAR(200)  NULL,
    status              VARCHAR(20)   NOT NULL COMMENT 'IMPORTED / EXISTS / BLOCKED / ERROR / NOT_INVOICE',
    location_code       VARCHAR(50)   NULL COMMENT 'the bunk the invoice belongs to (NULL when not worked out)',
    invoice_no          VARCHAR(30)   NULL,
    invoice_id          INT           NULL,
    detail              VARCHAR(500)  NULL,
    created_by          VARCHAR(45)   NULL COMMENT 'AUTO (scheduler) or the user who pressed Check now',
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    UNIQUE KEY uniq_oil_email_part (mailbox_id, message_key, part_id),
    KEY idx_oil_email_loc (location_code, creation_date),
    KEY idx_oil_email_mailbox (mailbox_id, creation_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Verify
SHOW TABLES LIKE 'm_oil_invoice_mailbox%';
SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'm_oil_invoice_mailbox' AND COLUMN_NAME IN ('access_mode', 'password_enc', 'token_hash');
SHOW TABLES LIKE 't_oil_invoice_email_log';
