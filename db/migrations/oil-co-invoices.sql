-- ============================================================================
-- Oil company charge invoices (/oil-invoices) — tkt #484
--
-- IOCL debits its charges to the dealer's SAP account and emails a GST invoice
-- for each one: License Fee Recovery (LFR, monthly on the 26th), E-Lock recovery,
-- XtraPower participation fee, merchant consent incentive, VMUS truck rental...
--
-- This is a register, not accounting: the SAP debit stays what books the charge
-- (the GST on these charges is not claimed — the auditor reverses it under
-- Rule 42 / 17(5), so the gross amount stays an expense). The invoice PDF is
-- kept, read, and linked to its SAP debit; the LFR invoice's breakup is checked
-- against the fuel invoices entered in Tank Receipts.
--
-- 1. m_oil_charge_type     — kinds of charge: SAP narration pattern, invoice text
--                            pattern, SAC. Global (all locations).
-- 2. t_oil_co_invoice      — one row per invoice, t_bank_id = the SAP debit it
--                            pays for (NULL until the SAP statement has it).
-- 3. t_oil_co_invoice_line — LFR breakup: one row per fuel invoice line.
-- 4. Menu OIL_CO_INVOICES under Transactions for Admin, PowerUser, SuperUser.
--    The page works at any location whose oil company account is IOCL.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS m_oil_charge_type (
    charge_code         VARCHAR(20)   NOT NULL,
    oil_company         VARCHAR(10)   NOT NULL DEFAULT 'IOCL',
    charge_name         VARCHAR(100)  NOT NULL,
    sap_pattern         VARCHAR(200)  NULL COMMENT 'REGEXP on the SAP narration; NULL = not debited on the SAP account',
    invoice_pattern     VARCHAR(200)  NULL COMMENT 'REGEXP on the invoice service head / description',
    sac_code            VARCHAR(10)   NULL,
    match_by            VARCHAR(10)   NOT NULL DEFAULT 'AMOUNT' COMMENT 'SAP_REF: SAP invoice no in the narration; AMOUNT: type + amount + nearest date; NONE',
    sort_order          INT           NOT NULL DEFAULT 0,
    notes               VARCHAR(300)  NULL,
    active_flag         CHAR(1)       NOT NULL DEFAULT 'Y',
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (charge_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO m_oil_charge_type (charge_code, oil_company, charge_name, sap_pattern, invoice_pattern, sac_code, match_by, sort_order, notes, created_by)
VALUES
    ('LFR',   'IOCL', 'License Fee Recovery (LFR)',        'LICEN[CS]E FEE|LFR',  'License Fee Recovery',  '997212', 'SAP_REF', 10, 'Monthly on the 26th, for the 26th of last month to the 25th', 'system'),
    ('ELOCK', 'IOCL', 'E-Lock Recovery',                   'E-?LOCK',             'E-?LOCK',               '999799', 'AMOUNT',  20, 'C4 E-LOCK RECOVERY FROM DEALERS', 'system'),
    ('XP',    'IOCL', 'XtraPower Participation Fee',       'PARTICIPATION FEE',   'PARTICIPATION FEE',     '997159', 'AMOUNT',  30, 'K1 PARTICIPATION FEE', 'system'),
    ('MCI',   'IOCL', 'Merchant Consent Incentive (Card)', 'MERCHANT CONSENT',    'MERCHANT CONSENT',      '998599', 'AMOUNT',  40, 'K0 MERCHANT CONSENT INCENTIVE-FL CARD', 'system'),
    ('C9',    'IOCL', 'Allied Facilities Fee',             'ALLIED FACILIT',      'ALLIED FACILIT',        NULL,     'AMOUNT',  50, 'C9 FEES RECD - ALLIED FACILITIES', 'system'),
    ('VMUS',  'IOCL', 'VMUS Rental (Tank Truck)',          NULL,                  'VMUS',                  '997319', 'NONE',    60, 'Deducted from the tank truck freight payment, not the SAP account', 'system'),
    ('OTHER', 'IOCL', 'Other IOCL Charge',                 NULL,                  NULL,                    NULL,     'AMOUNT',  99, 'Any other service head: matched by amount and date only', 'system')
ON DUPLICATE KEY UPDATE charge_code = charge_code;

CREATE TABLE IF NOT EXISTS t_oil_co_invoice (
    invoice_id          INT           NOT NULL AUTO_INCREMENT,
    location_code       VARCHAR(50)   NOT NULL,
    oil_company         VARCHAR(10)   NOT NULL DEFAULT 'IOCL',
    charge_code         VARCHAR(20)   NOT NULL,
    invoice_no          VARCHAR(30)   NOT NULL COMMENT 'GST invoice number (as in GSTR-2B)',
    sap_ref             VARCHAR(30)   NULL COMMENT 'LFR: SAP invoice no; others: FI document no',
    invoice_date        DATE          NOT NULL,
    description         VARCHAR(200)  NULL COMMENT 'service head / other details as printed',
    sac_code            VARCHAR(10)   NULL,
    supplier_gstin      VARCHAR(15)   NULL,
    recipient_gstin     VARCHAR(15)   NULL,
    recipient_name      VARCHAR(200)  NULL,
    taxable_value       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    igst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cess_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount        DECIMAL(12,2) NOT NULL,
    total_kl            DECIMAL(10,3) NULL COMMENT 'LFR: KL charged',
    t_bank_id           INT           NULL COMMENT 'the SAP debit this invoice is for',
    match_method        VARCHAR(10)   NULL COMMENT 'SAP_REF / AMOUNT / MANUAL; UNLINKED = unlinked by hand, not auto-linked again',
    doc_id              INT           NULL COMMENT 't_document_store (entity_type OIL_CO_INVOICE)',
    file_name           VARCHAR(200)  NULL,
    created_by          VARCHAR(45)   NULL,
    updated_by          VARCHAR(45)   NULL,
    creation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (invoice_id),
    UNIQUE KEY uniq_oil_inv_no (location_code, invoice_no),
    UNIQUE KEY uniq_oil_inv_bank (t_bank_id),
    KEY idx_oil_inv_date (location_code, invoice_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_oil_co_invoice_line (
    line_id               INT           NOT NULL AUTO_INCREMENT,
    invoice_id            INT           NOT NULL,
    sno                   INT           NOT NULL,
    delivery_no           VARCHAR(20)   NULL,
    delivery_date         DATE          NULL,
    purchase_invoice_no   VARCHAR(30)   NULL COMMENT 'the fuel invoice the fee is charged on',
    purchase_invoice_date DATE          NULL,
    product               VARCHAR(20)   NULL COMMENT 'from the rate: MS / HSD ...',
    qty_kl                DECIMAL(10,3) NULL,
    rate_per_kl           DECIMAL(10,2) NULL,
    net_amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cgst_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sgst_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    igst_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    line_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (line_id),
    KEY idx_oil_line_invoice (invoice_id),
    KEY idx_oil_line_purchase (purchase_invoice_no),
    CONSTRAINT fk_oil_line_invoice FOREIGN KEY (invoice_id) REFERENCES t_oil_co_invoice (invoice_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Menu: Transactions > IOCL Invoices, for Admin, PowerUser, SuperUser everywhere.
INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, group_code, effective_start_date, created_by)
SELECT 'OIL_CO_INVOICES', 'IOCL Invoices', 'bi-receipt-cutoff', '/oil-invoices', 'TRANSACTIONS', 74, 'TRANSACTIONS', CURDATE(), 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'OIL_CO_INVOICES' OR url_path = '/oil-invoices');

INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, created_by)
SELECT r.role, 'OIL_CO_INVOICES', 1, CURDATE(), 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser' UNION ALL SELECT 'Admin') r
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global g WHERE g.role = r.role AND g.menu_code = 'OIL_CO_INVOICES');

CALL RefreshMenuCache();

-- Verify
SELECT charge_code, charge_name, sap_pattern, invoice_pattern, sac_code, match_by FROM m_oil_charge_type ORDER BY sort_order;
SELECT role, menu_code, allowed FROM m_menu_access_global WHERE menu_code = 'OIL_CO_INVOICES';
