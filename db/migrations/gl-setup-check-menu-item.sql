-- ============================================================
-- GL Setup Check — Menu Item & Access
-- Generated: 2026-09-16
--
-- Adds the Accounting Setup Check page under ACCOUNTING group.
-- Run on dev and prod.
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('GL_SETUP_CHECK', 'Setup Check', 'bi-clipboard-check', '/gl/setup-check', NULL, 11, '2026-09-16', 'SAKTHI', 'SAKTHI', 'ACCOUNTING');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'GL_SETUP_CHECK', 1, '2026-09-16', 'SAKTHI', 'SAKTHI');

CALL RefreshMenuCache();

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY sequence;
