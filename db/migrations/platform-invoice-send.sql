-- ============================================================
-- Platform billing: send invoices over WhatsApp (tkt #460)
--
-- m_platform_invoice_contact = who receives a station's invoices.
-- For a station handled by a support partner this holds the
-- partner's number, not the dealer's.
--
-- share_token = secret part of the public /invoice/... link. The
-- Invoices page fills it in for any invoice that has none, and
-- clearing it kills the old link.
--
-- Run before deploying the code (the Invoices page reads these).
-- NOT re-runnable (plain ADD COLUMN — IF NOT EXISTS fails on this server).
-- ============================================================

CREATE TABLE IF NOT EXISTS m_platform_invoice_contact (
    location_code    VARCHAR(50)  NOT NULL,
    contact_name     VARCHAR(100) NULL,
    whatsapp_number  VARCHAR(15)  NOT NULL COMMENT 'Digits only, with country code',
    created_by       VARCHAR(45)  NULL,
    creation_date    DATETIME     NULL,
    updated_by       VARCHAR(45)  NULL,
    updation_date    DATETIME     NULL,
    PRIMARY KEY (location_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE t_platform_invoice
    ADD COLUMN share_token       CHAR(16)    NULL,
    ADD COLUMN sent_date         DATETIME    NULL COMMENT 'When the WhatsApp button was last tapped; not proof of delivery',
    ADD COLUMN sent_by           VARCHAR(45) NULL,
    ADD COLUMN sent_to           VARCHAR(15) NULL,
    ADD COLUMN first_opened_date DATETIME    NULL,
    ADD UNIQUE KEY uq_invoice_share_token (share_token);

-- ── Verify ───────────────────────────────────────────────────────────
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_platform_invoice'
  AND COLUMN_NAME IN ('share_token', 'sent_date', 'sent_by', 'sent_to', 'first_opened_date');
