-- ============================================================
-- Add "Deleted Shifts" menu item under Administration group
-- Visible to SuperUser only.
-- Safe to re-run: uses INSERT IGNORE + CALL RefreshMenuCache
-- ============================================================

-- 1. Insert the menu item (INSERT IGNORE skips if menu_code already exists)
INSERT IGNORE INTO m_menu_items (
    menu_code,
    menu_name,
    icon,
    url_path,
    parent_code,
    sequence,
    group_code,
    effective_start_date,
    created_by
)
VALUES (
    'DELETED_SHIFTS',
    'Deleted Shifts',
    'bi-trash3',
    '/deleted-closings',
    NULL,
    999,                   -- high sequence number — appears at end of group
    'ADMIN',               -- Administration group
    CURDATE(),
    'system'
);

-- 2. Grant access to SuperUser globally (INSERT IGNORE skips if already exists)
INSERT IGNORE INTO m_menu_access_global (
    role,
    menu_code,
    allowed,
    effective_start_date,
    created_by
)
VALUES (
    'SuperUser',
    'DELETED_SHIFTS',
    1,
    CURDATE(),
    'system'
);

-- 3. Rebuild the menu cache so the item appears immediately
CALL RefreshMenuCache();

SELECT 'Menu item DELETED_SHIFTS added for SuperUser' AS status;
