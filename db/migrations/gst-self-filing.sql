-- GST self-filing: tables behind /gst/hsn, /gst/rcm, /gst/itc and /gst/gstr3b.
-- Safe to run twice. Run gst-returns-menu.sql as well (the menu item for /gst).

-- HSN codes with the portal's description, used for Table 12 of GSTR-1.
-- Product -> HSN stays in m_product.hsn_code; this holds the description per code.
CREATE TABLE IF NOT EXISTS m_gst_hsn (
    hsn_code      VARCHAR(8)   NOT NULL,
    description   VARCHAR(500) NOT NULL,
    created_by    VARCHAR(45)  DEFAULT NULL,
    updated_by    VARCHAR(45)  DEFAULT NULL,
    creation_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (hsn_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='HSN code descriptions for GSTR-1 Table 12';

-- The codes the auditor filed for MUE (Sep-2026), with the portal's own descriptions.
INSERT IGNORE INTO m_gst_hsn (hsn_code, description, created_by) VALUES
('27101973', 'Engine oil conforming to standard IS 14234', 'system'),
('28070010', 'SULPHURIC ACID', 'system'),
('28539010', 'Distilled or conductivity water and water of similar purity', 'system'),
('27101219', 'PETROLEUM OILS AND OILS OBTAINED FROM BITUMINOUS MINERALS, OTHER THAN CRUDE; PREPARATIONS NOT ELSEWHERE SPECIFIED OR INCLUDED, CONTAINIGN BY WEIGHT 70% OR MORE OF PETROLEUM OILS OR OF OILS OBTAINED FROM BITUMINOUS MINERALS, THESE OILS BEING THE BASIC CONSTITUENTS OF THE PREPARATIONS; WASTE OILS--LIGHT OILS AND PREPARATIONS---MOTOR SPIRIT----OTHER', 'system');

INSERT IGNORE INTO m_gst_hsn (hsn_code, description, created_by) VALUES
('27111900', 'LIQUEFIED PETROLEUM GASES - OTHER (LPG CYLINDER)', 'system'),
('27112100', 'NATURAL GAS IN GASEOUS STATE (CNG)', 'system');

-- HSN by product category, used when a product's own HSN is missing and no product of the
-- same name at MUE / MC / MC2 / MME has one (services/gst-hsn-service.js).
-- Fuel codes follow MUE's filed returns; MC files diesel under 27101944 — confirm with the auditor.
CREATE TABLE IF NOT EXISTS m_gst_hsn_default (
    category      VARCHAR(20) NOT NULL COMMENT 'PETROL / DIESEL / CNG / LUBE / ACID / WATER / CYLINDER',
    hsn_code      VARCHAR(8)  NOT NULL,
    updated_by    VARCHAR(45) DEFAULT NULL,
    updation_date TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Default HSN per product category for GST returns';

INSERT IGNORE INTO m_gst_hsn_default (category, hsn_code, updated_by) VALUES
('PETROL', '27101219', 'system'), ('DIESEL', '27101219', 'system'), ('LUBE', '27101973', 'system'),
('ACID', '28070010', 'system'), ('WATER', '28539010', 'system'), ('CYLINDER', '27111900', 'system'),
('CNG', '27112100', 'system');

-- Inward supplies where we pay the tax (reverse charge), e.g. shop rent from a landlord
-- without GST registration. One row per self-invoice; goes to 3B 3.1(d) / 4A(3) and
-- GSTR-1 Table 13 (invoices for inward supply from unregistered person).
CREATE TABLE IF NOT EXISTS t_gst_rcm_inward (
    rcm_id            INT           NOT NULL AUTO_INCREMENT,
    location_code     VARCHAR(50)   NOT NULL,
    return_period     CHAR(6)       NOT NULL COMMENT 'MMYYYY',
    supplier_name     VARCHAR(150)  NOT NULL,
    description       VARCHAR(200)  NOT NULL,
    sac_code          VARCHAR(8)    DEFAULT NULL,
    taxable_value     DECIMAL(14,2) NOT NULL,
    gst_rate          DECIMAL(5,2)  NOT NULL DEFAULT 18.00,
    igst              DECIMAL(12,2) NOT NULL DEFAULT 0,
    cgst              DECIMAL(12,2) NOT NULL DEFAULT 0,
    sgst              DECIMAL(12,2) NOT NULL DEFAULT 0,
    self_invoice_no   VARCHAR(16)   NOT NULL,
    self_invoice_date DATE          NOT NULL,
    itc_class         VARCHAR(10)   NOT NULL DEFAULT 'COMMON' COMMENT 'TAXABLE / COMMON / EXEMPT / BLOCKED',
    notes             VARCHAR(255)  DEFAULT NULL,
    created_by        VARCHAR(45)   DEFAULT NULL,
    updated_by        VARCHAR(45)   DEFAULT NULL,
    creation_date     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (rcm_id),
    KEY idx_gst_rcm_loc_period (location_code, return_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Reverse charge inward supplies (self-invoices)';

-- GSTR-2B lines as uploaded from the portal. A new upload replaces the month.
CREATE TABLE IF NOT EXISTS t_gst_2b_invoice (
    gst2b_id        INT           NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50)   NOT NULL,
    return_period   CHAR(6)       NOT NULL COMMENT 'MMYYYY',
    section         VARCHAR(10)   NOT NULL COMMENT 'B2B / B2BA / CDNR / CDNRA',
    supplier_gstin  VARCHAR(15)   NOT NULL,
    supplier_name   VARCHAR(150)  DEFAULT NULL,
    supplier_period CHAR(6)       DEFAULT NULL,
    doc_no          VARCHAR(30)   NOT NULL,
    doc_date        DATE          DEFAULT NULL,
    doc_type        VARCHAR(5)    DEFAULT NULL COMMENT 'R regular, C credit note, D debit note',
    reverse_charge  CHAR(1)       NOT NULL DEFAULT 'N',
    itc_available   CHAR(1)       NOT NULL DEFAULT 'Y',
    itc_reason      VARCHAR(100)  DEFAULT NULL,
    taxable_value   DECIMAL(14,2) NOT NULL DEFAULT 0,
    igst            DECIMAL(12,2) NOT NULL DEFAULT 0,
    cgst            DECIMAL(12,2) NOT NULL DEFAULT 0,
    sgst            DECIMAL(12,2) NOT NULL DEFAULT 0,
    cess            DECIMAL(12,2) NOT NULL DEFAULT 0,
    itc_class       VARCHAR(10)   NOT NULL DEFAULT 'COMMON' COMMENT 'TAXABLE / COMMON / EXEMPT / BLOCKED',
    class_source    VARCHAR(10)   NOT NULL DEFAULT 'AUTO' COMMENT 'AUTO / USER',
    uploaded_by     VARCHAR(45)   DEFAULT NULL,
    upload_date     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (gst2b_id),
    KEY idx_gst_2b_loc_period (location_code, return_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='GSTR-2B invoices uploaded per return period';

-- What a supplier's bills are used for, remembered from the last choice on /gst/itc.
CREATE TABLE IF NOT EXISTS m_gst_itc_supplier (
    location_code  VARCHAR(50) NOT NULL,
    supplier_gstin VARCHAR(15) NOT NULL,
    itc_class      VARCHAR(10) NOT NULL,
    updated_by     VARCHAR(45) DEFAULT NULL,
    updation_date  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (location_code, supplier_gstin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Default ITC class per supplier GSTIN';

-- Per-month GSTR-3B inputs that PetroMath cannot work out: the credit ledger balance
-- brought forward, interest and late fee. Closing balance is saved so next month starts from it.
CREATE TABLE IF NOT EXISTS t_gst_period (
    location_code  VARCHAR(50)   NOT NULL,
    return_period  CHAR(6)       NOT NULL COMMENT 'MMYYYY',
    ecl_open_igst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ecl_open_cgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ecl_open_sgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ecl_close_igst DECIMAL(12,2) DEFAULT NULL,
    ecl_close_cgst DECIMAL(12,2) DEFAULT NULL,
    ecl_close_sgst DECIMAL(12,2) DEFAULT NULL,
    interest_cgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    interest_sgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    late_fee_cgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    late_fee_sgst  DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes          VARCHAR(500)  DEFAULT NULL,
    updated_by     VARCHAR(45)   DEFAULT NULL,
    updation_date  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (location_code, return_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='GSTR-3B worksheet inputs per month';

-- Check
SELECT COUNT(*) AS hsn_codes FROM m_gst_hsn;
SHOW TABLES LIKE 't_gst_%';
