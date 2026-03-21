-- ============================================================
-- Employee Management Migration
-- Run once on each environment (dev / staging / prod)
-- Safe to re-run: uses IF NOT EXISTS throughout
-- ============================================================

-- ── Table 0: t_document_store ────────────────────────────────
-- Generic binary/document store. Used for employee photos today;
-- designed to hold invoices, receipts, ID proofs, etc. in the future.
--
-- entity_type  — logical category of the owner: 'EMPLOYEE', 'SUPPLIER', 'INVOICE', ...
-- entity_id    — PK of the owning record in its respective table
-- doc_category — role of this document: 'PROFILE_PHOTO', 'ID_PROOF', 'INVOICE_SCAN', ...
-- file_data    — raw bytes (MEDIUMBLOB: up to 16 MB)
--
-- Serving: GET /documents/:doc_id  (authenticated, streams file_data with correct Content-Type)
-- Size limit: controlled per-location via m_location_config key DOC_MAX_UPLOAD_MB (default 2)
CREATE TABLE IF NOT EXISTS t_document_store (
    doc_id          INT            NOT NULL AUTO_INCREMENT,
    entity_type     VARCHAR(50)    NOT NULL,
    entity_id       INT            NOT NULL,
    doc_category    VARCHAR(50)    NOT NULL,
    file_name       VARCHAR(255)   NOT NULL,
    mime_type       VARCHAR(50)    NOT NULL,
    file_size       INT            NOT NULL,
    file_data       MEDIUMBLOB     NOT NULL,
    location_code   VARCHAR(50)    NULL,
    notes           VARCHAR(255)   NULL,
    created_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (doc_id),
    KEY idx_doc_entity (entity_type, entity_id),
    KEY idx_doc_category (doc_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 1: m_employee ──────────────────────────────────────
-- Employee master. Names are NOT unique — employee_code is the identifier.
-- Re-hiring creates a new record; history is preserved by keeping the old row.
-- Salary is NOT stored here — see m_employee_salary.
-- photo_doc_id → FK to t_document_store for the employee's current profile photo.
CREATE TABLE IF NOT EXISTS m_employee (
    employee_id     INT            NOT NULL AUTO_INCREMENT,
    employee_code   VARCHAR(20)    NOT NULL,
    location_code   VARCHAR(50)    NOT NULL,
    name            VARCHAR(100)   NOT NULL,
    nickname        VARCHAR(50)    NULL,
    mobile          VARCHAR(15)    NULL,
    designation     VARCHAR(50)    NULL,
    joined_date     DATE           NULL,
    left_date       DATE           NULL,
    is_active       CHAR(1)        NOT NULL DEFAULT 'Y',
    person_id       INT            NULL,
    photo_doc_id    INT            NULL,                -- FK to t_document_store
    notes           TEXT           NULL,
    created_by      VARCHAR(45)    NULL,
    updated_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id),
    UNIQUE KEY uq_emp_code_loc (employee_code, location_code),
    KEY idx_emp_location (location_code),
    KEY idx_emp_active (is_active),
    KEY idx_emp_person (person_id),
    CONSTRAINT fk_emp_photo
        FOREIGN KEY (photo_doc_id) REFERENCES t_document_store (doc_id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: m_employee_salary ───────────────────────────────
-- Salary history. One row per salary revision.
-- Current salary = latest row where effective_from <= TODAY.
-- When a revision is added, the previous row's effective_to is stamped automatically.
CREATE TABLE IF NOT EXISTS m_employee_salary (
    salary_id       INT            NOT NULL AUTO_INCREMENT,
    employee_id     INT            NOT NULL,
    location_code   VARCHAR(50)    NOT NULL,
    salary_amount   DECIMAL(10,2)  NOT NULL,
    salary_type     VARCHAR(10)    NOT NULL DEFAULT 'MONTHLY',
    effective_from  DATE           NOT NULL,
    effective_to    DATE           NULL,
    notes           VARCHAR(255)   NULL,
    created_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (salary_id),
    KEY idx_sal_employee (employee_id),
    KEY idx_sal_effective (effective_from),
    CONSTRAINT fk_sal_employee
        FOREIGN KEY (employee_id) REFERENCES m_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: t_employee_ledger ───────────────────────────────
-- Every financial movement for an employee.
-- Balance = SUM(credit_amount) - SUM(debit_amount)
-- salary_period: YYYY-MM (monthly) or YYYY-WNN (weekly) — informational only.
CREATE TABLE IF NOT EXISTS t_employee_ledger (
    ledger_id       INT            NOT NULL AUTO_INCREMENT,
    employee_id     INT            NOT NULL,
    location_code   VARCHAR(50)    NOT NULL,
    txn_date        DATE           NOT NULL,
    txn_type        VARCHAR(30)    NOT NULL,
    credit_amount   DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    debit_amount    DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    description     VARCHAR(255)   NULL,
    reference_id    INT            NULL,
    salary_period   VARCHAR(10)    NULL,
    created_by      VARCHAR(45)    NULL,
    creation_date   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ledger_id),
    KEY idx_ledger_employee (employee_id),
    KEY idx_ledger_date (txn_date),
    KEY idx_ledger_period (salary_period),
    CONSTRAINT fk_ledger_employee
        FOREIGN KEY (employee_id) REFERENCES m_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seed: m_lookup — EMPLOYEE_DESIGNATION ────────────────────
INSERT IGNORE INTO m_lookup
    (lookup_type, description, tag, location_code, start_date_active, end_date_active, created_by, creation_date, updation_date)
VALUES
    ('EMPLOYEE_DESIGNATION', 'Pump Attendant', 'PUMP_ATTENDANT', NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW()),
    ('EMPLOYEE_DESIGNATION', 'Cashier',        'CASHIER',        NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW()),
    ('EMPLOYEE_DESIGNATION', 'Supervisor',     'SUPERVISOR',     NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW()),
    ('EMPLOYEE_DESIGNATION', 'Manager',        'MANAGER',        NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW()),
    ('EMPLOYEE_DESIGNATION', 'Helper',         'HELPER',         NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW()),
    ('EMPLOYEE_DESIGNATION', 'Cleaner',        'CLEANER',        NULL, CURDATE(), '9999-12-31', 'MIGRATION', NOW(), NOW());

-- ── Seed: m_location_config ───────────────────────────────────
INSERT IGNORE INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date)
VALUES
    ('*', 'EMPLOYEE_AUTO_SALARY', 'N', CURDATE(), '9999-12-31'),
    -- Max upload size in MB for documents (photos, invoices, etc.)
    -- Override per location by inserting a row with the specific location_code.
    ('*', 'DOC_MAX_UPLOAD_MB',    '2', CURDATE(), '9999-12-31');

-- ── Permissions ──────────────────────────────────────────────
INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'VIEW_EMPLOYEE',            0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'ADD_EMPLOYEE',             0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'EDIT_EMPLOYEE',            0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'DISABLE_EMPLOYEE',         0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'ADD_EMPLOYEE_LEDGER',      0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

INSERT IGNORE INTO m_role_permissions (role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code)
SELECT r.role_id, 'GENERATE_EMPLOYEE_SALARY', 0, CURDATE(), '9999-12-31', NULL FROM m_roles r WHERE r.role_name IN ('Admin', 'SuperUser');

-- ── Menu ─────────────────────────────────────────────────────
INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
VALUES
    ('EMPLOYEES', 'Employees', '/employees', 'MASTERS', 95, 'MASTERS', CURDATE(), '9999-12-31');

INSERT IGNORE INTO m_menu_access_global (menu_code, role_name, effective_start_date, effective_end_date)
VALUES
    ('EMPLOYEES', 'Admin',     CURDATE(), '9999-12-31'),
    ('EMPLOYEES', 'SuperUser', CURDATE(), '9999-12-31');
