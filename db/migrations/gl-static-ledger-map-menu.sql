-- ============================================================
-- Static Ledger Map — Menu Item & Access
-- Generated: 2026-08-15
--
-- Adds the Static Ledger Map review screen under the ACCOUNTING group.
-- ============================================================

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('GL_STATIC_LEDGER_MAP', 'Static Ledger Map', 'bi-signpost-split', '/gl/static-ledger-map', NULL, 11, '2026-08-15', 'ADMIN', 'ADMIN', 'ACCOUNTING');

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'GL_STATIC_LEDGER_MAP', 1, '2026-08-15', 'ADMIN', 'ADMIN');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY sequence;
