-- ============================================================
-- Distributor Payables Migration
-- Tracks distributors who refer/manage certain locations and earn
-- a commission on PetroMath's platform billing revenue from them
-- (e.g. Gobinath gets 50% of what AACBE pays). Mirrors the
-- invoice -> payment -> allocation shape from the platform-billing
-- migration: here it's commission (amount owed) -> payout -> allocation.
-- Run once on each environment (dev / staging / prod)
-- Safe to re-run: uses IF NOT EXISTS throughout
-- ============================================================

-- ── Table 1: m_distributor ───────────────────────────────────
CREATE TABLE IF NOT EXISTS m_distributor (
    distributor_id        INT           NOT NULL AUTO_INCREMENT,
    distributor_name      VARCHAR(150)  NOT NULL,
    phone                 VARCHAR(50)   NULL,
    effective_start_date  DATE          NOT NULL,
    effective_end_date    DATE          NOT NULL DEFAULT '9999-12-31',
    remarks               VARCHAR(255)  NULL,
    created_by            VARCHAR(45)   NULL,
    creation_date         DATE          NULL,
    updated_by            VARCHAR(45)   NULL,
    updation_date         DATE          NULL,
    PRIMARY KEY (distributor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: m_location_distributor ──────────────────────────
-- Which distributor covers a location, and their commission %,
-- date-ranged (same pattern as m_location_billing_plan).
CREATE TABLE IF NOT EXISTS m_location_distributor (
    assignment_id         INT           NOT NULL AUTO_INCREMENT,
    location_code         VARCHAR(50)   NOT NULL,
    distributor_id        INT           NOT NULL,
    commission_percent    DECIMAL(5,2)  NOT NULL,
    effective_start_date  DATE          NOT NULL,
    effective_end_date    DATE          NOT NULL DEFAULT '9999-12-31',
    created_by            VARCHAR(45)   NULL,
    creation_date         DATE          NULL,
    updated_by            VARCHAR(45)   NULL,
    updation_date         DATE          NULL,
    PRIMARY KEY (assignment_id),
    KEY idx_ld_location_effective (location_code, effective_start_date, effective_end_date),
    KEY idx_ld_distributor (distributor_id),
    CONSTRAINT fk_ld_distributor
        FOREIGN KEY (distributor_id) REFERENCES m_distributor (distributor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_distributor_commission ────────────────────────
-- One row auto-created whenever a platform payment is recorded
-- for a location that has an active distributor assignment.
CREATE TABLE IF NOT EXISTS t_distributor_commission (
    commission_id       INT           NOT NULL AUTO_INCREMENT,
    payment_id           INT          NOT NULL,
    distributor_id         INT        NOT NULL,
    location_code            VARCHAR(50) NOT NULL,
    payment_amount             DECIMAL(12,2) NOT NULL,
    commission_percent           DECIMAL(5,2)  NOT NULL,
    commission_amount              DECIMAL(12,2) NOT NULL,
    status                          ENUM('PENDING','PAID') NOT NULL DEFAULT 'PENDING',
    created_by                       VARCHAR(45) NULL,
    creation_date                      DATE      NULL,
    PRIMARY KEY (commission_id),
    KEY idx_tdc_distributor (distributor_id),
    KEY idx_tdc_payment (payment_id),
    CONSTRAINT fk_tdc_distributor
        FOREIGN KEY (distributor_id) REFERENCES m_distributor (distributor_id),
    CONSTRAINT fk_tdc_payment
        FOREIGN KEY (payment_id) REFERENCES t_platform_payment (payment_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 4: t_distributor_payout ────────────────────────────
-- PetroMath's actual payouts to a distributor.
CREATE TABLE IF NOT EXISTS t_distributor_payout (
    payout_id         INT           NOT NULL AUTO_INCREMENT,
    distributor_id      INT          NOT NULL,
    payout_date            DATE      NOT NULL,
    amount                    DECIMAL(12,2) NOT NULL,
    payment_mode                ENUM('MANUAL_CASH','MANUAL_BANK','MANUAL_UPI','MANUAL_CHEQUE','OTHER') NOT NULL DEFAULT 'MANUAL_CASH',
    reference_number               VARCHAR(100) NULL,
    remarks                          VARCHAR(255) NULL,
    created_by                        VARCHAR(45) NULL,
    creation_date                       DATE      NULL,
    updated_by                           VARCHAR(45) NULL,
    updation_date                          DATE    NULL,
    PRIMARY KEY (payout_id),
    KEY idx_tdp_distributor (distributor_id),
    CONSTRAINT fk_tdp_distributor
        FOREIGN KEY (distributor_id) REFERENCES m_distributor (distributor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 5: t_distributor_payout_allocation ─────────────────
-- Join table: one payout can settle several commission entries
-- (bulk payout), a commission entry is settled by one payout.
CREATE TABLE IF NOT EXISTS t_distributor_payout_allocation (
    allocation_id      INT           NOT NULL AUTO_INCREMENT,
    payout_id            INT         NOT NULL,
    commission_id           INT      NOT NULL,
    allocated_amount           DECIMAL(12,2) NOT NULL,
    created_by                   VARCHAR(45) NULL,
    creation_date                  DATE      NULL,
    PRIMARY KEY (allocation_id),
    UNIQUE KEY uq_payout_commission (payout_id, commission_id),
    KEY idx_tdpa_commission (commission_id),
    CONSTRAINT fk_tdpa_payout
        FOREIGN KEY (payout_id) REFERENCES t_distributor_payout (payout_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tdpa_commission
        FOREIGN KEY (commission_id) REFERENCES t_distributor_commission (commission_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Add UPI/GPay as a payment mode on platform payments too ──
ALTER TABLE t_platform_payment
    MODIFY COLUMN payment_mode ENUM('MANUAL_CASH','MANUAL_BANK','MANUAL_UPI','MANUAL_CHEQUE','RAZORPAY','OTHER')
    NOT NULL DEFAULT 'MANUAL_CASH';

-- ============================================================
-- Verify
-- ============================================================
SELECT 'Migration complete' AS status;
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'm_distributor',
      'm_location_distributor',
      't_distributor_commission',
      't_distributor_payout',
      't_distributor_payout_allocation'
  )
ORDER BY TABLE_NAME;
