-- ============================================================
-- GL Control — Menu Item & Access
-- Generated: 2026-05-02
--
-- Adds the GL Control page under the ACCOUNTING group.
-- Run on dev and prod.
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('GL_CONTROL', 'GL Control', 'bi-sliders', '/gl/control', NULL, 8, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'GL_CONTROL', 1, '2026-05-02', 'SAKTHI', 'SAKTHI');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY sequence;
