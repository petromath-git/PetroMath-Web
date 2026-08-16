-- ============================================================
-- Correction Queue — Menu Item & Access
-- Generated: 2026-08-16
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('GL_CORRECTION_QUEUE', 'Correction Queue', 'bi-arrow-repeat', '/gl/correction-queue', NULL, 12, '2026-08-16', 'ADMIN', 'ADMIN', 'ACCOUNTING');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'GL_CORRECTION_QUEUE', 1, '2026-08-16', 'ADMIN', 'ADMIN');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY sequence;
