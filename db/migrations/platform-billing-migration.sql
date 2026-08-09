-- ============================================================
-- Platform Billing Migration
-- PetroMath's own subscription invoicing + payment tracking,
-- per location (not to be confused with fuel/oil-company billing).
-- Run once on each environment (dev / staging / prod)
-- Safe to re-run: uses IF NOT EXISTS throughout
-- ============================================================

-- ── Table 1: m_location_billing_plan ─────────────────────────
-- Per-location rate + discount + prepay-duration, date-ranged
-- (same effective_start_date/effective_end_date pattern as
-- m_location_config). A location can have monthly (1) or
-- annual (12) prepay; plan_duration_months is deliberately not
-- an ENUM so 24/36-month tiers can be added later without a
-- schema change.
CREATE TABLE IF NOT EXISTS m_location_billing_plan (
    billing_plan_id      INT            NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(50)    NOT NULL,
    plan_duration_months INT            NOT NULL DEFAULT 1,   -- 1 = monthly, 12 = annual
    plan_rate            DECIMAL(12,2)  NOT NULL DEFAULT 0,   -- price for the whole duration (not per-month)
    discount_type        ENUM('NONE','PERCENT','FIXED') NOT NULL DEFAULT 'NONE',
    discount_value        DECIMAL(12,2) NOT NULL DEFAULT 0,
    trial_end_date        DATE          NULL,                -- no invoice generated until this date passes
    effective_start_date  DATE          NOT NULL,
    effective_end_date    DATE          NOT NULL DEFAULT '9999-12-31',
    remarks                VARCHAR(255) NULL,
    created_by             VARCHAR(45)  NULL,
    creation_date           DATE        NULL,
    updated_by              VARCHAR(45) NULL,
    updation_date            DATE       NULL,
    PRIMARY KEY (billing_plan_id),
    KEY idx_lbp_location_effective (location_code, effective_start_date, effective_end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: t_platform_invoice ──────────────────────────────
-- One row per location per billing period (month or year).
CREATE TABLE IF NOT EXISTS t_platform_invoice (
    invoice_id        INT           NOT NULL AUTO_INCREMENT,
    location_code      VARCHAR(50)   NOT NULL,
    invoice_number      VARCHAR(50)   NOT NULL,
    period_start_date   DATE          NOT NULL,
    period_end_date     DATE          NOT NULL,
    gross_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_amount             DECIMAL(12,2) NOT NULL DEFAULT 0,
    due_date                DATE         NOT NULL,
    status                   ENUM('UNPAID','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'UNPAID',
    generated_date            DATE        NOT NULL,
    created_by                VARCHAR(45) NULL,
    creation_date               DATE      NULL,
    updated_by                  VARCHAR(45) NULL,
    updation_date                 DATE    NULL,
    PRIMARY KEY (invoice_id),
    UNIQUE KEY uq_invoice_number (invoice_number),
    UNIQUE KEY uq_location_period (location_code, period_start_date),
    KEY idx_invoice_status (status),
    KEY idx_invoice_period (period_start_date, period_end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_platform_invoice_items ────────────────────────
-- Line items per invoice (base rate, discount line, future add-ons).
CREATE TABLE IF NOT EXISTS t_platform_invoice_items (
    item_id       INT           NOT NULL AUTO_INCREMENT,
    invoice_id    INT           NOT NULL,
    description    VARCHAR(255)  NOT NULL,
    amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    sort_order       INT          NOT NULL DEFAULT 1,
    PRIMARY KEY (item_id),
    KEY idx_pii_invoice_id (invoice_id),
    CONSTRAINT fk_pii_invoice
        FOREIGN KEY (invoice_id) REFERENCES t_platform_invoice (invoice_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 4: t_platform_payment ──────────────────────────────
-- One row per payment received. gateway_* columns stay unused
-- until a payment gateway is integrated (Phase 2) — no schema
-- change needed at that point.
CREATE TABLE IF NOT EXISTS t_platform_payment (
    payment_id       INT           NOT NULL AUTO_INCREMENT,
    location_code     VARCHAR(50)   NOT NULL,
    payment_date        DATE         NOT NULL,
    amount                DECIMAL(12,2) NOT NULL,
    payment_mode           ENUM('MANUAL_CASH','MANUAL_BANK','MANUAL_CHEQUE','RAZORPAY','OTHER') NOT NULL DEFAULT 'MANUAL_CASH',
    reference_number         VARCHAR(100) NULL,
    gateway_txn_id             VARCHAR(150) NULL,
    gateway_payload               JSON      NULL,
    status                          ENUM('RECORDED','CONFIRMED','FAILED','REFUNDED') NOT NULL DEFAULT 'RECORDED',
    remarks                          VARCHAR(255) NULL,
    created_by                       VARCHAR(45) NULL,
    creation_date                      DATE     NULL,
    updated_by                          VARCHAR(45) NULL,
    updation_date                        DATE    NULL,
    PRIMARY KEY (payment_id),
    KEY idx_pp_location_date (location_code, payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 5: t_platform_payment_allocation ───────────────────
-- Join table: allows one payment to cover several invoices
-- (bulk / advance payment) and an invoice to be paid across
-- several payments (partial payment).
CREATE TABLE IF NOT EXISTS t_platform_payment_allocation (
    allocation_id     INT           NOT NULL AUTO_INCREMENT,
    payment_id         INT          NOT NULL,
    invoice_id           INT        NOT NULL,
    allocated_amount       DECIMAL(12,2) NOT NULL,
    created_by               VARCHAR(45) NULL,
    creation_date              DATE     NULL,
    PRIMARY KEY (allocation_id),
    UNIQUE KEY uq_payment_invoice (payment_id, invoice_id),
    KEY idx_ppa_invoice_id (invoice_id),
    CONSTRAINT fk_ppa_payment
        FOREIGN KEY (payment_id) REFERENCES t_platform_payment (payment_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ppa_invoice
        FOREIGN KEY (invoice_id) REFERENCES t_platform_invoice (invoice_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Permission seed
-- Master (cross-location) billing screens are gated by this
-- permission via security.hasPermission('MANAGE_PLATFORM_BILLING')
-- (see utils/app-security.js). m_role_permissions requires a
-- non-null can_reset_role_id even for non-password-reset
-- permission types (existing convention elsewhere in this repo)
-- so it is set to the same role — it is not used by the
-- generic hasPermission() lookup.
--
-- IMPORTANT: this seeds the permission GLOBALLY (location_code
-- IS NULL) for SuperUser, which means every location's own
-- SuperUser login would see every other location's invoices.
-- That is almost certainly NOT what you want for billing data.
-- Do NOT run the block below as-is — instead decide which
-- specific login(s) should have master access (e.g. a dedicated
-- PetroMath HQ location_code) and run:
--
--   INSERT INTO m_role_permissions
--       (role_id, can_reset_role_id, permission_type, location_specific, location_code, created_by)
--   SELECT r.role_id, r.role_id, 'MANAGE_PLATFORM_BILLING', 1, '<HQ_LOCATION_CODE>', 'migration'
--   FROM m_roles r
--   WHERE r.role_name = 'SuperUser'
--     AND NOT EXISTS (
--       SELECT 1 FROM m_role_permissions rp
--       WHERE rp.role_id = r.role_id AND rp.permission_type = 'MANAGE_PLATFORM_BILLING'
--         AND rp.location_code = '<HQ_LOCATION_CODE>'
--     );
--
-- replacing <HQ_LOCATION_CODE> with the actual login's location_code.
-- ============================================================

-- ============================================================
-- Verify
-- ============================================================
SELECT 'Migration complete' AS status;
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'm_location_billing_plan',
      't_platform_invoice',
      't_platform_invoice_items',
      't_platform_payment',
      't_platform_payment_allocation'
  )
ORDER BY TABLE_NAME;
