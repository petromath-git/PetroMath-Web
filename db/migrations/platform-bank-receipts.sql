-- ============================================================
-- Platform billing: bank statement receipts (tkt #459)
--
-- PetroMath's own IOB account, uploaded to record subscription
-- receipts. Each credit line is tagged to the location that paid.
-- Deliberately separate from the location bank tables
-- (m_bank, t_bank_transaction) and from GL: no ledgers here.
--
-- Run before deploying the code (Payments page reads the link table).
-- ============================================================

-- One row per statement file uploaded
CREATE TABLE IF NOT EXISTS t_platform_bank_upload (
    upload_id      INT          NOT NULL AUTO_INCREMENT,
    file_name      VARCHAR(255) NULL,
    from_date      DATE         NULL,
    to_date        DATE         NULL,
    lines_added    INT          NOT NULL DEFAULT 0,
    lines_skipped  INT          NOT NULL DEFAULT 0,
    created_by     VARCHAR(45)  NULL,
    creation_date  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per credit on the statement (debits are not kept).
-- dedup_key = hash of date + amount + balance + narration, so an
-- overlapping statement can be uploaded again safely.
CREATE TABLE IF NOT EXISTS t_platform_bank_txn (
    bank_txn_id    INT           NOT NULL AUTO_INCREMENT,
    upload_id      INT           NOT NULL,
    txn_date       DATE          NOT NULL,
    description    VARCHAR(500)  NULL,
    reference      VARCHAR(100)  NULL,
    payer_name     VARCHAR(150)  NULL,
    credit_amount  DECIMAL(12,2) NOT NULL,
    balance_amount DECIMAL(14,2) NULL,
    dedup_key      CHAR(40)      NOT NULL,
    status         ENUM('UNTAGGED','TAGGED','IGNORED') NOT NULL DEFAULT 'UNTAGGED',
    location_code  VARCHAR(50)   NULL,
    tagged_by      VARCHAR(45)   NULL,
    tagged_date    TIMESTAMP     NULL,
    PRIMARY KEY (bank_txn_id),
    UNIQUE KEY uq_pbt_dedup (dedup_key),
    KEY idx_pbt_status_date (status, txn_date),
    KEY idx_pbt_upload (upload_id),
    CONSTRAINT fk_pbt_upload FOREIGN KEY (upload_id) REFERENCES t_platform_bank_upload (upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Statement line <-> payment. Many to many because real receipts are both
-- ways round: BAF's 1,750 payment came as 1,700 + 50.
-- created_payment = 1 when tagging this line created the payment, so Undo
-- knows to remove it; 0 = linked to a payment that was entered by hand.
CREATE TABLE IF NOT EXISTS t_platform_bank_txn_payment (
    link_id         INT           NOT NULL AUTO_INCREMENT,
    bank_txn_id     INT           NOT NULL,
    payment_id      INT           NOT NULL,
    linked_amount   DECIMAL(12,2) NOT NULL,
    created_payment TINYINT(1)    NOT NULL DEFAULT 0,
    created_by      VARCHAR(45)   NULL,
    creation_date   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (link_id),
    UNIQUE KEY uq_pbtp (bank_txn_id, payment_id),
    KEY idx_pbtp_payment (payment_id),
    CONSTRAINT fk_pbtp_txn FOREIGN KEY (bank_txn_id) REFERENCES t_platform_bank_txn (bank_txn_id),
    CONSTRAINT fk_pbtp_payment FOREIGN KEY (payment_id) REFERENCES t_platform_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Remembered payers: narration containing match_text => this location
CREATE TABLE IF NOT EXISTS m_platform_payer_alias (
    alias_id       INT          NOT NULL AUTO_INCREMENT,
    match_text     VARCHAR(150) NOT NULL,
    location_code  VARCHAR(50)  NOT NULL,
    created_by     VARCHAR(45)  NULL,
    creation_date  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (alias_id),
    UNIQUE KEY uq_ppa_text (match_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('t_platform_bank_upload', 't_platform_bank_txn', 't_platform_bank_txn_payment', 'm_platform_payer_alias');
