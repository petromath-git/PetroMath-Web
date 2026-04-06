-- ============================================================
-- Bowser Module Migration
-- Safe to re-run: uses IF NOT EXISTS / INSERT IGNORE throughout
-- ============================================================

-- ── Table 1: m_bowser (Bowser Master) ────────────────────────
CREATE TABLE IF NOT EXISTS m_bowser (
    bowser_id       INT            NOT NULL AUTO_INCREMENT,
    location_code   VARCHAR(50)    NOT NULL,
    bowser_name     VARCHAR(100)   NOT NULL,
    capacity_litres DECIMAL(10,3)  NOT NULL DEFAULT 0,
    product_id      INT            NOT NULL,
    is_active       CHAR(1)        NOT NULL DEFAULT 'Y',
    created_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(45)    NULL,
    updation_date   DATETIME       NULL,
    PRIMARY KEY (bowser_id),
    KEY idx_bowser_location (location_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: t_closing_intercompany ──────────────────────────
-- Bowser fill entries recorded inside the SFS shift closing.
-- One row per bowser per shift closing.
CREATE TABLE IF NOT EXISTS t_closing_intercompany (
    id              INT            NOT NULL AUTO_INCREMENT,
    closing_id      INT            NOT NULL,
    closing_date    DATE           NOT NULL,
    location_code   VARCHAR(50)    NOT NULL,
    bowser_id       INT            NOT NULL,
    product_id      INT            NOT NULL,
    quantity        DECIMAL(10,3)  NOT NULL DEFAULT 0,
    created_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_interco_closing  (closing_id),
    KEY idx_interco_bowser   (bowser_id),
    KEY idx_interco_date     (closing_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_bowser_closing ─────────────────────────────────
-- One row per bowser per day. Meter-based reconciliation.
CREATE TABLE IF NOT EXISTS t_bowser_closing (
    bowser_closing_id INT           NOT NULL AUTO_INCREMENT,
    bowser_id         INT           NOT NULL,
    location_code     VARCHAR(50)   NOT NULL,
    closing_date      DATE          NOT NULL,
    opening_meter     DECIMAL(12,3) NOT NULL DEFAULT 0,
    closing_meter     DECIMAL(12,3) NOT NULL DEFAULT 0,
    fills_received    DECIMAL(10,3) NOT NULL DEFAULT 0,
    opening_stock     DECIMAL(10,3) NOT NULL DEFAULT 0,
    status            ENUM('DRAFT','CLOSED') NOT NULL DEFAULT 'DRAFT',
    created_by        VARCHAR(45)   NULL,
    creation_date     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by        VARCHAR(45)   NULL,
    updation_date     DATETIME      NULL,
    PRIMARY KEY (bowser_closing_id),
    UNIQUE KEY uq_bowser_date (bowser_id, closing_date),
    KEY idx_bowser_closing_loc (location_code, closing_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 4: t_bowser_delivery_items ─────────────────────────
-- Line items for each bowser closing. One row per delivery.
CREATE TABLE IF NOT EXISTS t_bowser_delivery_items (
    item_id           INT           NOT NULL AUTO_INCREMENT,
    bowser_closing_id INT           NOT NULL,
    sale_type         VARCHAR(10)   NOT NULL COMMENT 'CREDIT / DIGITAL / CASH',
    creditlist_id     INT           NULL      COMMENT 'Populated for CREDIT sales',
    vehicle_id        INT           NULL,
    product_id        INT           NOT NULL,
    quantity          DECIMAL(10,3) NOT NULL DEFAULT 0,
    rate              DECIMAL(10,4) NOT NULL DEFAULT 0,
    amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
    digital_vendor_id INT           NULL      COMMENT 'FK to m_credit_list where card_flag=Y',
    digital_ref       VARCHAR(100)  NULL      COMMENT 'UPI/card ref for DIGITAL',
    created_by        VARCHAR(45)   NULL,
    creation_date     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (item_id),
    KEY idx_bdi_closing  (bowser_closing_id),
    KEY idx_bdi_credit   (creditlist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Permissions ───────────────────────────────────────────────
INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'MANAGE_BOWSER_MASTER',  0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'VIEW_BOWSER_CLOSING',   0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser', 'Cashier');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'MANAGE_BOWSER_CLOSING', 0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

-- ── Menu items ────────────────────────────────────────────────
-- Bowser Master (under MASTERS group — uses same parent_code as other master items)
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
SELECT
    'BOWSER_MASTER',
    'Bowser Master',
    '/bowser/master',
    MAX(parent_code),
    96,
    'MASTERS',
    CURDATE(),
    '9999-12-31'
FROM m_menu_items
WHERE group_code = 'MASTERS'
  AND parent_code IS NOT NULL;

-- Bowser Closing (standalone under BOWSER group)
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
VALUES
    ('BOWSER_CLOSING', 'Bowser Closing', '/bowser/closing', NULL, 10, 'BOWSER', CURDATE(), '9999-12-31');

-- Menu access restricted to SFS location only (not global).
-- Uses m_menu_access_override so the menu only appears for SFS users.
-- Replace 'SFS' with the actual location_code if different.
INSERT IGNORE INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, effective_end_date, created_by)
VALUES
    ('Admin',     'SFS', 'BOWSER_MASTER',  1, CURDATE(), '9999-12-31', 'system'),
    ('SuperUser', 'SFS', 'BOWSER_MASTER',  1, CURDATE(), '9999-12-31', 'system'),
    ('Admin',     'SFS', 'BOWSER_CLOSING', 1, CURDATE(), '9999-12-31', 'system'),
    ('SuperUser', 'SFS', 'BOWSER_CLOSING', 1, CURDATE(), '9999-12-31', 'system'),
    ('Cashier',   'SFS', 'BOWSER_CLOSING', 1, CURDATE(), '9999-12-31', 'system');

CALL RefreshMenuCache();

SELECT 'Bowser module tables and menu created.' AS status;
