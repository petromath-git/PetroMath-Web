INSERT IGNORE INTO m_menu_items
    (menu_code, menu_name, url_path, parent_code, sequence, group_code, effective_start_date, effective_end_date)
VALUES
    ('INTERCOMPANY_LEDGER_REPORT', 'Intercompany Ledger', '/reports/stock/intercompany-ledger', 'REPORTS', 92, 'REPORTS_SECTION', CURDATE(), '9999-12-31');

INSERT IGNORE INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT
    role,
    'INTERCOMPANY_LEDGER_REPORT',
    allowed,
    CURDATE(),
    effective_end_date,
    'system',
    'system'
FROM m_menu_access_global
WHERE menu_code = 'STOCK_LEDGER';

INSERT IGNORE INTO m_menu_access_override
    (role, location_code, menu_code, allowed, effective_start_date, effective_end_date, created_by, updated_by)
SELECT
    role,
    location_code,
    'INTERCOMPANY_LEDGER_REPORT',
    allowed,
    CURDATE(),
    effective_end_date,
    'system',
    'system'
FROM m_menu_access_override
WHERE menu_code = 'STOCK_LEDGER';

SELECT menu_code, menu_name, url_path, sequence
FROM m_menu_items
WHERE menu_code = 'INTERCOMPANY_LEDGER_REPORT';
