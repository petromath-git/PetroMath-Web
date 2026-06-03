-- ============================================================
-- Bowser Report — menu item
-- Safe to re-run: uses INSERT IGNORE throughout
-- ============================================================

INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
VALUES
    ('BOWSER_REPORT', 'Bowser Report', '/bowser/report', NULL, 20, 'BOWSER', CURDATE(), '9999-12-31');

-- Restrict to SFS location only (same as other bowser menu items)
INSERT IGNORE INTO m_menu_access_override
    (role, location_code, menu_code, allowed, effective_start_date, effective_end_date, created_by)
VALUES
    ('Admin',     'SFS', 'BOWSER_REPORT', 1, CURDATE(), '9999-12-31', 'system'),
    ('SuperUser', 'SFS', 'BOWSER_REPORT', 1, CURDATE(), '9999-12-31', 'system');

CALL RefreshMenuCache();

SELECT 'Bowser Report menu item added.' AS status;
