-- ============================================================
-- Add "Lookup Admin" menu item under Masters group
-- Accessible to Admin and SuperUser roles.
-- Safe to re-run: uses INSERT IGNORE + CALL RefreshMenuCache
--
-- NOTE: parent_code must match the Masters nav parent menu item's
--       menu_code. Adjust if your Masters parent has a different code.
--       Run this to find it:
--         SELECT DISTINCT parent_code FROM m_menu_items
--         WHERE group_code = 'MASTERS' AND parent_code IS NOT NULL;
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
SELECT
    'LOOKUP_ADMIN',
    'Lookup Admin',
    'bi-list-check',
    '/masters/lookup-admin',
    MAX(parent_code),   -- picks the parent_code used by other Masters children
    99,
    'MASTERS',
    CURDATE(),
    'system'
FROM m_menu_items
WHERE group_code = 'MASTERS'
  AND parent_code IS NOT NULL
  AND (effective_end_date IS NULL OR effective_end_date >= CURDATE());

-- 2. Fix parent_code if LOOKUP_ADMIN was previously inserted with NULL parent_code
UPDATE m_menu_items mi
JOIN (
    SELECT DISTINCT parent_code
    FROM m_menu_items
    WHERE group_code = 'MASTERS'
      AND parent_code IS NOT NULL
      AND menu_code != 'LOOKUP_ADMIN'
      AND (effective_end_date IS NULL OR effective_end_date >= CURDATE())
    LIMIT 1
) pc ON 1=1
SET mi.parent_code = pc.parent_code
WHERE mi.menu_code = 'LOOKUP_ADMIN'
  AND mi.parent_code IS NULL;

-- 3. Grant access to Admin role globally
INSERT IGNORE INTO m_menu_access_global (
    role,
    menu_code,
    allowed,
    effective_start_date,
    created_by
)
VALUES
    ('Admin', 'LOOKUP_ADMIN', 1, CURDATE(), 'system'),
    ('SuperUser', 'LOOKUP_ADMIN', 1, CURDATE(), 'system');

-- 4. Rebuild the menu cache so the item appears immediately
CALL RefreshMenuCache();

SELECT 'Menu item LOOKUP_ADMIN added/fixed under Masters' AS status;
