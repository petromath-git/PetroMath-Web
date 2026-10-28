-- ============================================================================
-- Support Tickets (rework of /dev-tracker)
--
-- 1. t_dev_tracker.scope: LOCATION = one station's request, ALL = built for every
--    location. Existing rows are the platform backlog, so they become ALL.
-- 2. t_dev_tracker_comments: conversation on a ticket (replaces WhatsApp).
--    is_internal = 1 rows are only shown to DEV_TRACKER_MANAGE users.
-- 3. t_dev_tracker_worklog: hours spent per ticket per day. actual_hours on the
--    ticket is kept as the SUM of these rows by the app.
-- 4. Menus: access is by menu grant, not by role.
--      DEV_TRACKER        "Support Tickets"  raise / view / comment  -> PowerUser (+ existing)
--      DEV_TRACKER_MANAGE "Ticket Hours"     triage, tasks, hours     -> same roles as DEV_TRACKER today
--    Rolling out to station users later = grant DEV_TRACKER to Admin/Manager
--    (globally or per location override). No code change.
--
-- Safe to re-run.
-- ============================================================================

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_dev_tracker' AND COLUMN_NAME = 'scope'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE t_dev_tracker ADD COLUMN scope ENUM(''LOCATION'',''ALL'') NOT NULL DEFAULT ''LOCATION'' AFTER location_code',
    'SELECT ''scope column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Only on the first run (column just added): the existing backlog is platform work
SET @sql := IF(@col_exists = 0,
    'UPDATE t_dev_tracker SET scope = ''ALL''',
    'SELECT ''scope already populated'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS t_dev_tracker_comments (
    comment_id     INT          NOT NULL AUTO_INCREMENT,
    tracker_id     INT          NOT NULL,
    comment_text   TEXT         NOT NULL,
    is_internal    TINYINT(1)   NOT NULL DEFAULT 0,
    created_by     VARCHAR(45)  NULL,
    creation_date  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id),
    KEY idx_dev_tracker_comments_tracker (tracker_id),
    CONSTRAINT fk_dev_tracker_comments_parent FOREIGN KEY (tracker_id) REFERENCES t_dev_tracker (tracker_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS t_dev_tracker_worklog (
    worklog_id     INT           NOT NULL AUTO_INCREMENT,
    tracker_id     INT           NOT NULL,
    work_date      DATE          NOT NULL,
    hours          DECIMAL(5,2)  NOT NULL,
    note           VARCHAR(500)  NULL,
    source         VARCHAR(20)   NOT NULL DEFAULT 'Manual' COMMENT 'Manual / Claude',
    created_by     VARCHAR(45)   NULL,
    creation_date  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (worklog_id),
    KEY idx_dev_tracker_worklog_tracker (tracker_id),
    KEY idx_dev_tracker_worklog_date (work_date),
    CONSTRAINT fk_dev_tracker_worklog_parent FOREIGN KEY (tracker_id) REFERENCES t_dev_tracker (tracker_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Carry over hours already typed into actual_hours as one opening worklog row each,
-- so SUM(worklog) = actual_hours from day one.
INSERT INTO t_dev_tracker_worklog (tracker_id, work_date, hours, note, source, created_by)
SELECT t.tracker_id, DATE(t.updation_date), t.actual_hours, 'Hours recorded before work log', 'Manual', 'system'
FROM t_dev_tracker t
WHERE t.actual_hours > 0
  AND NOT EXISTS (SELECT 1 FROM t_dev_tracker_worklog w WHERE w.tracker_id = t.tracker_id);

-- Menus ---------------------------------------------------------------------
UPDATE m_menu_items
SET menu_name = 'Support Tickets', icon = 'bi-life-preserver', restriction_level = 3,
    updated_by = 'system'
WHERE menu_code = 'DEV_TRACKER';

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, restriction_level,
     effective_start_date, created_by, updated_by, group_code)
SELECT 'DEV_TRACKER_MANAGE', 'Ticket Hours', 'bi-stopwatch', '/dev-tracker/hours',
       NULL, 136, 1, CURDATE(), 'system', 'system', 'ADMIN'
WHERE NOT EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'DEV_TRACKER_MANAGE');

-- Manage = whoever has DEV_TRACKER today (before PowerUser is added below)
INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT g.role, 'DEV_TRACKER_MANAGE', g.allowed, CURDATE(), g.effective_end_date, 'system', 'system'
FROM m_menu_access_global g
WHERE g.menu_code = 'DEV_TRACKER'
  AND g.role <> 'PowerUser'
  AND CURDATE() BETWEEN g.effective_start_date AND COALESCE(g.effective_end_date, '9999-12-31')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_global x
                  WHERE x.menu_code = 'DEV_TRACKER_MANAGE' AND x.role = g.role);

-- Support team raises tickets
INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT 'PowerUser', 'DEV_TRACKER', 1, CURDATE(), 'system', 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_menu_access_global
                  WHERE menu_code = 'DEV_TRACKER' AND role = 'PowerUser');

CALL RefreshMenuCache();
