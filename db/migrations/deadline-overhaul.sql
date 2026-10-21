-- Deadlines overhaul (/deadline).
--
-- Old design: one t_deadline row per date. Renewing meant overwriting the date
-- (history lost) and ticking "Closed" (so the next renewal never warned), and
-- "hard_stop" only decided whether an overdue row stayed on screen.
--
-- New design:
--   m_deadline_category  — fixed list of categories, each with a default reminder window
--   m_deadline_item      — the thing being tracked (licence, certificate, stamping, bill...)
--                          with its NEXT due date. Stays OPEN until renewed or closed.
--   t_deadline_renewal   — one row per renewal / completion (history)
--   m_bank_holiday       — bank holidays: a plain calendar, no reminders
--   t_push_subscription  — phones/browsers that turned on reminders
--   t_push_log           — one row per reminder sent (also stops a double send)
--
-- t_deadline / t_deadline_v are left in place untouched (nothing reads them
-- after this release) so the old data stays available for a rollback.
-- Safe to re-run: CREATE IF NOT EXISTS, and the copy skips rows already copied.

CREATE TABLE IF NOT EXISTS m_deadline_category (
    category_id          INT          NOT NULL AUTO_INCREMENT,
    category_code        VARCHAR(30)  NOT NULL,
    category_name        VARCHAR(100) NOT NULL,
    default_remind_days  INT          NOT NULL,
    sort_order           INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (category_id),
    UNIQUE KEY uq_deadline_category_code (category_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO m_deadline_category (category_code, category_name, default_remind_days, sort_order) VALUES
    ('LICENCE',     'Licences & Permits',      60, 10),
    ('CALIBRATION', 'Calibration & Stamping',  30, 20),
    ('FIRE',        'Fire Safety',             15, 30),
    ('TANKER',      'Tanker Documents',        15, 40),
    ('INSURANCE',   'Insurance',               30, 50),
    ('AMC',         'AMC & Service',           30, 60),
    ('BILLS',       'Rent & Bills',             5, 70),
    ('FILING',      'Statutory Filings',        3, 80),
    ('OTHER',       'Others',                  15, 90);

CREATE TABLE IF NOT EXISTS m_deadline_item (
    item_id              INT           NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(45)   NOT NULL,
    category_id          INT           NOT NULL,
    title                VARCHAR(200)  NOT NULL,
    reference_no         VARCHAR(100)  DEFAULT NULL COMMENT 'Vehicle no, serial no, licence no...',
    due_date             DATE          NOT NULL COMMENT 'Next due / expiry date',
    repeat_months        INT           NOT NULL DEFAULT 0 COMMENT '0 = one-time; else suggested gap to the next due date',
    remind_days          INT           NOT NULL COMMENT 'Start reminding this many days before due_date',
    notes                TEXT,
    status               VARCHAR(10)   NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN or DONE',
    closed_date          DATE          DEFAULT NULL,
    closed_by            VARCHAR(45)   DEFAULT NULL,
    legacy_deadline_id   INT           DEFAULT NULL COMMENT 't_deadline row this was copied from',
    created_by           VARCHAR(45)   DEFAULT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(45)   DEFAULT NULL,
    updation_date        TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (item_id),
    UNIQUE KEY uq_deadline_item_legacy (legacy_deadline_id),
    KEY idx_deadline_item_loc (location_code, status, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_deadline_renewal (
    renewal_id           INT           NOT NULL AUTO_INCREMENT,
    item_id              INT           NOT NULL,
    previous_due_date    DATE          NOT NULL,
    done_date            DATE          NOT NULL,
    next_due_date        DATE          DEFAULT NULL COMMENT 'NULL = closed, no next date',
    note                 VARCHAR(500)  DEFAULT NULL,
    done_by              VARCHAR(45)   DEFAULT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (renewal_id),
    KEY idx_deadline_renewal_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS m_bank_holiday (
    holiday_id           INT           NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(45)   NOT NULL,
    holiday_date         DATE          NOT NULL,
    description          VARCHAR(200)  NOT NULL,
    created_by           VARCHAR(45)   DEFAULT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (holiday_id),
    UNIQUE KEY uq_bank_holiday (location_code, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_push_subscription (
    subscription_id      INT           NOT NULL AUTO_INCREMENT,
    person_id            INT           NOT NULL,
    endpoint             VARCHAR(1000) NOT NULL,
    endpoint_hash        CHAR(64)      NOT NULL COMMENT 'sha256(endpoint), for the unique key',
    p256dh               VARCHAR(200)  NOT NULL,
    auth                 VARCHAR(100)  NOT NULL,
    user_agent           VARCHAR(300)  DEFAULT NULL,
    fail_count           INT           NOT NULL DEFAULT 0,
    last_success_at      DATETIME      DEFAULT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date        TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (subscription_id),
    UNIQUE KEY uq_push_endpoint (endpoint_hash),
    KEY idx_push_person (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_push_log (
    log_id               INT           NOT NULL AUTO_INCREMENT,
    digest_date          DATE          NOT NULL,
    location_code        VARCHAR(45)   NOT NULL,
    subscription_id      INT           NOT NULL,
    person_id            INT           NOT NULL,
    title                VARCHAR(200)  NOT NULL,
    body                 VARCHAR(500)  NOT NULL,
    status               VARCHAR(10)   NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING, SENT, FAILED, GONE',
    error                VARCHAR(500)  DEFAULT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    UNIQUE KEY uq_push_log_once (digest_date, location_code, subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Copy the old rows
-- ---------------------------------------------------------------------------

-- Bank holidays → calendar (one per location per date)
INSERT IGNORE INTO m_bank_holiday (location_code, holiday_date, description, created_by, creation_date)
SELECT ml.location_code, td.deadline_date,
       COALESCE(NULLIF(TRIM(REPLACE(REPLACE(td.comment, '\r', ''), '\n', ' ')), ''), 'Bank holiday'),
       td.created_by, td.creation_date
FROM t_deadline td
JOIN m_location ml ON ml.location_id = td.location_id
JOIN m_lookup lk ON lk.lookup_id = td.purpose AND lk.lookup_type = 'Deadline'
WHERE lk.description = 'Bank Holiday';

-- Everything else → deadline items.
--   Comment line 1 = title, line 2 = reference (SFS types the vehicle / serial no there).
--   Status:
--     closed 'Y', date still ahead  → OPEN (users renewed by moving the date AND ticking Closed)
--     closed 'Y', date passed       → DONE
--     not closed, date ahead        → OPEN
--     not closed, date passed, "hard stop" ticked ('Y', or 'o' from the old new-row bug)
--                                   → OPEN (they chose to keep seeing it)
--     not closed, date passed, no hard stop
--                                   → DONE, noted as archived (already hidden on the old page)
--   Category: Tank Truck → Tanker Documents, Pump Stamping → Calibration & Stamping,
--   Others → guessed from the words in the comment (users can change it).
INSERT INTO m_deadline_item
    (location_code, category_id, title, reference_no, due_date, repeat_months, remind_days, notes,
     status, closed_date, closed_by, legacy_deadline_id, created_by, creation_date, updated_by)
SELECT x.location_code,
       (SELECT c.category_id FROM m_deadline_category c WHERE c.category_code = x.cat),
       LEFT(COALESCE(NULLIF(x.line1, ''), x.purpose_name), 200),
       NULLIF(LEFT(x.line2, 100), ''),
       x.deadline_date, 0, GREATEST(COALESCE(x.warning_day, 0), 0),
       CASE WHEN x.new_status = 'ARCHIVED' THEN 'Archived when deadlines moved to the new page: the date had passed and it was no longer shown.' END,
       CASE WHEN x.new_status = 'OPEN' THEN 'OPEN' ELSE 'DONE' END,
       CASE WHEN x.new_status = 'OPEN' THEN NULL
            WHEN x.new_status = 'ARCHIVED' THEN x.deadline_date
            ELSE DATE(COALESCE(x.updation_date, x.deadline_date)) END,
       CASE WHEN x.new_status = 'OPEN' THEN NULL ELSE 'migration' END,
       x.t_deadline_id, x.created_by, CASE WHEN x.creation_date > '2000-01-01' THEN x.creation_date ELSE COALESCE(x.updation_date, NOW()) END, 'migration'
FROM (
    SELECT td.*, ml.location_code, lk.description AS purpose_name,
           TRIM(SUBSTRING_INDEX(REPLACE(COALESCE(td.comment, ''), '\r', ''), '\n', 1)) AS line1,
           CASE WHEN REPLACE(COALESCE(td.comment, ''), '\r', '') LIKE '%\n%'
                THEN TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(td.comment, '\r', ''), '\n', 2), '\n', -1))
                ELSE '' END AS line2,
           CASE
               WHEN td.deadline_date >= CURDATE() THEN 'OPEN'
               WHEN td.closed = 'Y' THEN 'DONE'
               WHEN td.hard_stop IN ('Y', 'o') THEN 'OPEN'
               ELSE 'ARCHIVED'
           END AS new_status,
           CASE
               WHEN lk.description = 'Tank Truck'    THEN 'TANKER'
               WHEN lk.description = 'Pump Stamping' THEN 'CALIBRATION'
               WHEN UPPER(td.comment) LIKE '%FIRE%' OR UPPER(td.comment) LIKE '%EXTINGUISHER%' THEN 'FIRE'
               WHEN UPPER(td.comment) LIKE '%INSURANCE%' THEN 'INSURANCE'
               WHEN UPPER(td.comment) LIKE '%LICENSE%' OR UPPER(td.comment) LIKE '%LICENCE%'
                 OR UPPER(td.comment) LIKE '%PESO%' OR UPPER(td.comment) LIKE '%PERMIT%'
                 OR UPPER(td.comment) LIKE '%LEASE%' THEN 'LICENCE'
               WHEN UPPER(td.comment) LIKE '%HYDROMETER%' OR UPPER(td.comment) LIKE '%THERMOMETER%'
                 OR UPPER(td.comment) LIKE '%THERMOMTER%' OR UPPER(td.comment) LIKE '%CALIBRATION%'
                 OR UPPER(td.comment) LIKE '%STAMPING%' OR UPPER(td.comment) LIKE '%MEASURE%'
                 OR UPPER(td.comment) LIKE '%GAUGE%' OR UPPER(td.comment) LIKE '%DENSITY%' THEN 'CALIBRATION'
               WHEN UPPER(td.comment) LIKE '%AMC%' OR UPPER(td.comment) LIKE '%SERVICE%' THEN 'AMC'
               WHEN UPPER(td.comment) LIKE '%RENT%' OR UPPER(td.comment) LIKE '%BILL%'
                 OR UPPER(td.comment) LIKE '%RECHARGE%' THEN 'BILLS'
               WHEN UPPER(td.comment) LIKE '%GST%' OR UPPER(td.comment) LIKE '%REPORT%' THEN 'FILING'
               ELSE 'OTHER'
           END AS cat
    FROM t_deadline td
    JOIN m_location ml ON ml.location_id = td.location_id
    JOIN m_lookup lk ON lk.lookup_id = td.purpose AND lk.lookup_type = 'Deadline'
    WHERE lk.description <> 'Bank Holiday'
      AND NOT EXISTS (SELECT 1 FROM m_deadline_item di WHERE di.legacy_deadline_id = td.t_deadline_id)
) x;

-- Menu: same entry (DEADLINE_MANAGER, /deadline), clearer name
UPDATE m_menu_items SET menu_name = 'Deadlines & Renewals' WHERE menu_code = 'DEADLINE_MANAGER';
CALL RefreshMenuCache();

-- Verify
SELECT location_code, status, COUNT(*) AS items FROM m_deadline_item GROUP BY location_code, status ORDER BY location_code, status;
SELECT location_code, COUNT(*) AS holidays FROM m_bank_holiday GROUP BY location_code ORDER BY location_code;
