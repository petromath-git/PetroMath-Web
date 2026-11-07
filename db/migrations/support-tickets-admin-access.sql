-- ============================================================================
-- Support Tickets: open to the Admin role at MC, MUE, MME and MC2.
--
-- Data only, on top of support-tickets.sql. Admins raise tickets for their login
-- location and see only the tickets they raised (ownOnly in
-- controllers/dev-tracker-controller.js).
--
-- To add another location later, add a row in Menu Management or re-run this with
-- the location added. Users pick up the menu when they next log in or switch
-- location.
--
-- Safe to re-run.
-- ============================================================================

INSERT INTO m_menu_access_override
    (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
SELECT 'Admin', l.location_code, 'DEV_TRACKER', 1, CURDATE(), 'support-tickets-admin', 'support-tickets-admin'
FROM m_location l
WHERE l.location_code IN ('MC', 'MUE', 'MME', 'MC2')
  AND NOT EXISTS (SELECT 1 FROM m_menu_access_override o
                  WHERE o.role = 'Admin' AND o.location_code = l.location_code
                    AND o.menu_code = 'DEV_TRACKER');

CALL RefreshMenuCache();
