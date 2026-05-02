-- ============================================================
-- GL Accounting — Menu Items & Access
-- Generated: 2026-05-02
--
-- Adds menu items for all GL reports and Manual Journal
-- under the existing ACCOUNTING group.
-- Run on dev and prod.
-- ============================================================

-- ── Menu Items ────────────────────────────────────────────────────────────────

INSERT INTO m_menu_items
    (menu_code, menu_name, icon, url_path, parent_code, sequence, effective_start_date, created_by, updated_by, group_code)
VALUES
    ('GL_MANUAL_JOURNAL', 'Manual Journal',  'bi-pencil-square',  '/gl/journal',         NULL, 2, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'),
    ('GL_DAY_BOOK',       'Day Book',         'bi-journal-text',   '/gl/day-book',        NULL, 3, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'),
    ('GL_LEDGER',         'Ledger Report',    'bi-book',           '/gl/ledger',          NULL, 4, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'),
    ('GL_TRIAL_BALANCE',  'Trial Balance',    'bi-clipboard-data', '/gl/trial-balance',   NULL, 5, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'),
    ('GL_PROFIT_LOSS',    'Profit & Loss',    'bi-graph-up',       '/gl/profit-loss',     NULL, 6, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING'),
    ('GL_BALANCE_SHEET',  'Balance Sheet',    'bi-building',       '/gl/balance-sheet',   NULL, 7, '2026-05-02', 'SAKTHI', 'SAKTHI', 'ACCOUNTING');

-- ── Global Access (SuperUser) ─────────────────────────────────────────────────

INSERT INTO m_menu_access_global
    (role, menu_code, allowed, effective_start_date, created_by, updated_by)
VALUES
    ('SuperUser', 'GL_MANUAL_JOURNAL', 1, '2026-05-02', 'SAKTHI', 'SAKTHI'),
    ('SuperUser', 'GL_DAY_BOOK',       1, '2026-05-02', 'SAKTHI', 'SAKTHI'),
    ('SuperUser', 'GL_LEDGER',         1, '2026-05-02', 'SAKTHI', 'SAKTHI'),
    ('SuperUser', 'GL_TRIAL_BALANCE',  1, '2026-05-02', 'SAKTHI', 'SAKTHI'),
    ('SuperUser', 'GL_PROFIT_LOSS',    1, '2026-05-02', 'SAKTHI', 'SAKTHI'),
    ('SuperUser', 'GL_BALANCE_SHEET',  1, '2026-05-02', 'SAKTHI', 'SAKTHI');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT menu_code, menu_name, sequence, group_code
FROM m_menu_items
WHERE group_code = 'ACCOUNTING'
ORDER BY sequence;
