-- ============================================================
-- Dealer Convention Lead Capture
-- Public, no-login mobile form for the PetroMath stall at dealer
-- conventions — collects prospect details from visiting dealers.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

-- contact_role — 'OWNER', 'MANAGER', or 'OTHER'
-- lead_mode    — how the lead was captured: 'STALL', 'PHONE', 'WEBSITE', 'WHATSAPP'.
--                Only 'STALL' is wired up today (this form); the others are
--                reserved for future entry points into this same table.
-- generated_by — who captured the lead (e.g. the staff member at the booth for
--                STALL, or the person who took the call for PHONE).
CREATE TABLE IF NOT EXISTS t_dealer_lead (
    lead_id                 INT             NOT NULL AUTO_INCREMENT,
    bunk_name               VARCHAR(150)    NOT NULL,
    place                   VARCHAR(100)    NOT NULL,
    district                VARCHAR(100)    NOT NULL,
    phone_number            VARCHAR(15)     NOT NULL,
    oil_company             VARCHAR(50)     NOT NULL,
    contact_person_name     VARCHAR(100)    NULL,
    contact_role            VARCHAR(20)     NOT NULL,
    lead_mode               VARCHAR(20)     NOT NULL DEFAULT 'STALL',
    generated_by            VARCHAR(100)    NULL,
    notes                   VARCHAR(500)    NULL,
    ip_address              VARCHAR(45)     NULL,
    creation_date           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lead_id),
    KEY idx_dealer_lead_mode (lead_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
