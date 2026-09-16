-- ============================================================
-- GL Accounting: group setup-only pages under an "Accounting > Setup"
-- submenu, separate from day-to-day pages (Manual Journal, Day Book,
-- Trial Balance, P&L, Balance Sheet, GL Control, Correction Queue).
-- Generated: 2026-09-16
--
-- Requires the layout.pug fix (same commit/PR) that lets one group_code
-- hold both flat items and a nested dropdown at once — without it, this
-- either silently hides the new submenu or crashes every Accounting
-- user's page load, depending on menuDetails row order. Do not run this
-- against a deploy that doesn't have that layout.pug fix.
--
-- Per the existing parent/child menu gotcha: a child with no access
-- granted to its PARENT is invisible even if the child itself has
-- access. PowerUser already has access to 4 of these 6 items as flat
-- entries today (Ledgers, Ledger Groups, Static Ledger Map, Product
-- Ledger Map) — granting ACCOUNTING_SETUP to PowerUser too preserves
-- that, or they'd silently lose access to all four once reparented.
-- ============================================================

-- ── Step 1: New "Setup" submenu header ──────────────────────────────────────
INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('ACCOUNTING_SETUP', 'Setup', 'bi-tools', NULL, NULL, 13, '2026-09-16', 'SAKTHI', 'SAKTHI', 'ACCOUNTING');

-- ── Step 2: Reparent the 6 setup pages under it, in the requested order ────
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 101 WHERE menu_code = 'GL_SETUP_CHECK';
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 102 WHERE menu_code = 'GL_FINANCIAL_YEARS';
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 103 WHERE menu_code = 'PRODUCT_LEDGER_MAP';
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 104 WHERE menu_code = 'GL_LEDGERS';
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 105 WHERE menu_code = 'GL_LEDGER_GROUPS';
UPDATE m_menu_items SET parent_code = 'ACCOUNTING_SETUP', sequence = 106 WHERE menu_code = 'GL_STATIC_LEDGER_MAP';

-- ── Step 3: Access for the new parent — union of its children's existing roles ──
INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'ACCOUNTING_SETUP', 1, '2026-09-16', 'SAKTHI', 'SAKTHI'),
    ('PowerUser', 'ACCOUNTING_SETUP', 1, '2026-09-16', 'SAKTHI', 'SAKTHI');

CALL RefreshMenuCache();

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, parent_code, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY (parent_code IS NOT NULL), sequence;
