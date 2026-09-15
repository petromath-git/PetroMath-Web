-- ============================================================
-- Menu item restriction_level
--
-- Replaces the URL-prefix blacklist in menu-management-controller.js
-- (PLATFORM_ONLY_URL_PREFIXES) with an explicit per-item column. The
-- prefix approach was fundamentally broken: a parent/group header item
-- (e.g. PLATFORM_BILLING_HEAD) has url_path = NULL, so no prefix check
-- can ever catch it, and it's easy to simply forget an item (found
-- DISTRIBUTOR_PAYABLES/DISTRIBUTOR_LEDGER, ONBOARDING_ADMIN, and
-- DELETED_SHIFTS all leaking through on a full audit).
--
-- Semantics: the minimum privilege tier required to grant/toggle this
-- item to a role+location via Global Access (SuperUser-only) or
-- Location Overrides (SuperUser + PowerUser today). 1 = SuperUser
-- only. 3 = SuperUser + PowerUser (and, in future, Admin, if Admin
-- ever gets menu-management access for its own location). There is no
-- level 2 in this rollout -- reserved for a possible future tier
-- between PowerUser and Admin.
--
-- This does NOT gate an end user's own nav visibility -- that stays
-- governed entirely by whatever access grants already exist for their
-- role. It only gates who can grant access to *others* from the
-- Menu Management screens.
--
-- Run once per environment. Safe to re-run: idempotent ALTER + plain
-- UPDATEs (setting the same value twice is a no-op).
-- ============================================================

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_menu_items' AND COLUMN_NAME = 'restriction_level'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE m_menu_items ADD COLUMN restriction_level TINYINT NOT NULL DEFAULT 3 AFTER sequence',
    'SELECT ''restriction_level column already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Level 1 (SuperUser only): platform-level screens (billing, dev tooling, usage
-- stats, assigning user locations), plus onboarding creation/migration and the
-- deleted-shifts restore tool -- all already SuperUser-only at the route level,
-- this just makes the menu system agree.
UPDATE m_menu_items
SET restriction_level = 1
WHERE menu_code IN (
    'ASSIGN_USER_LOCATIONS', 'DEV_DB_REFRESH', 'DEV_TRACKER', 'SYS_HEALTH',
    'USAGE_DASHBOARD', 'ONBOARDING_ADMIN', 'DELETED_SHIFTS',
    'PLATFORM_BILLING_HEAD', 'PLATFORM_BILLING_MASTER', 'PLATFORM_BILLING_PAYMENTS',
    'PLATFORM_BILLING_PLANS', 'PLATFORM_BILLING_LEDGER', 'PLATFORM_BILLING_MY_INVOICES',
    'DISTRIBUTOR_PAYABLES', 'DISTRIBUTOR_LEDGER'
);

-- Everything else stays at the default (3) -- confirmed via full menu audit
-- 2026-09-15: GL structural screens (Ledger Groups, Static Ledger Map,
-- Correction Queue, Account Heads) are already pinned to req.user.location_code
-- in their own controllers (never a global/NULL row), so granting them is
-- contained to the grantee's own location like any other master-data screen --
-- deliberately NOT restricted here.
