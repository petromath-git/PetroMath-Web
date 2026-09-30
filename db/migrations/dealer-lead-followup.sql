-- ============================================================
-- Dealer Leads — follow-up tracking
--
-- Adds a sales pipeline on top of t_dealer_lead:
--   status             — NEW, CONTACTED, INTERESTED, DEMO, ONBOARDING, WON,
--                        NOT_INTERESTED, INVALID
--   assigned_to        — m_persons.Person_id of the lead's current owner
--   next_followup_date — when the owner should call next (NULL once closed)
--   last_contacted_at  — time of the last logged activity
-- and t_dealer_lead_activity: one row per call / WhatsApp / visit / demo /
-- note / detail edit, so the full history stays on the lead as it moves
-- between callers.
--
-- Access: new MANAGE_DEALER_LEADS permission (SuperUser + PowerUser), and
-- the DEALER_LEADS menu item is extended to PowerUser. PowerUser exists
-- on beta only for now — on a DB without that role the PowerUser grants
-- simply skip it; re-run steps 2-3 after PowerUser is created.
--
-- Step 1 (ALTER / CREATE) is NOT re-runnable (plain ADD COLUMN — IF NOT
-- EXISTS fails on this server). Steps 2-4 are (NOT EXISTS guards).
-- ============================================================

-- ── 1. Schema ─────────────────────────────────────────────────────────
ALTER TABLE t_dealer_lead
    ADD COLUMN status             VARCHAR(20) NOT NULL DEFAULT 'NEW' AFTER is_priority,
    ADD COLUMN assigned_to        INT         NULL AFTER status,
    ADD COLUMN next_followup_date DATE        NULL AFTER assigned_to,
    ADD COLUMN last_contacted_at  DATETIME    NULL AFTER next_followup_date,
    ADD COLUMN updated_by         VARCHAR(45) NULL,
    ADD COLUMN updation_date      DATETIME    NULL,
    ADD INDEX idx_dealer_lead_status (status),
    ADD INDEX idx_dealer_lead_assigned (assigned_to),
    ADD INDEX idx_dealer_lead_followup (next_followup_date);

-- activity_type — CALL, WHATSAPP, VISIT, DEMO, NOTE, EDIT
-- outcome       — NO_ANSWER, CALL_BACK, INTERESTED, DEMO_FIXED, DEMO_DONE,
--                 NOT_INTERESTED, WRONG_NUMBER, OTHER, DETAILS_UPDATED (EDIT)
-- status_after / assigned_to_after / next_followup_date — the lead's state
-- right after this activity, so the timeline shows every change.
CREATE TABLE t_dealer_lead_activity (
    activity_id         INT           NOT NULL AUTO_INCREMENT,
    lead_id             INT           NOT NULL,
    activity_type       VARCHAR(20)   NOT NULL,
    outcome             VARCHAR(30)   NOT NULL,
    notes               VARCHAR(1000) NULL,
    status_after        VARCHAR(20)   NOT NULL,
    assigned_to_after   INT           NULL,
    next_followup_date  DATE          NULL,
    created_by_id       INT           NOT NULL,
    created_by          VARCHAR(45)   NULL,
    creation_date       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (activity_id),
    KEY idx_dealer_lead_activity_lead (lead_id),
    CONSTRAINT fk_dealer_lead_activity_lead FOREIGN KEY (lead_id) REFERENCES t_dealer_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Permission — SuperUser + PowerUser ─────────────────────────────
-- Global grant (location_code NULL); leads are not location-scoped.
-- can_reset_role_id is NOT NULL with no default — set to role_id.
-- NOT "INSERT IGNORE": the unique index does not dedupe a NULL location_code.
INSERT INTO m_role_permissions
    (role_id, can_reset_role_id, permission_type, location_specific, effective_start_date, effective_end_date, location_code, created_by)
SELECT r.role_id, r.role_id, 'MANAGE_DEALER_LEADS', 0, CURDATE(), '9999-12-31', NULL, 'system'
FROM m_roles r
WHERE r.role_name IN ('SuperUser', 'PowerUser')
  AND NOT EXISTS (
      SELECT 1 FROM m_role_permissions rp
      WHERE rp.role_id = r.role_id
        AND rp.permission_type = 'MANAGE_DEALER_LEADS'
        AND rp.location_code IS NULL
  );

-- ── 3. Menu — extend DEALER_LEADS (dealer-leads-menu.sql) to PowerUser ─
INSERT INTO m_menu_access_global (role, menu_code, allowed, effective_start_date, effective_end_date, created_by)
SELECT x.role, 'DEALER_LEADS', 1, CURDATE(), '9999-12-31', 'system'
FROM (SELECT 'SuperUser' AS role UNION ALL SELECT 'PowerUser') x
WHERE EXISTS (SELECT 1 FROM m_menu_items WHERE menu_code = 'DEALER_LEADS')
  AND EXISTS (SELECT 1 FROM m_roles r WHERE r.role_name = x.role)
  AND NOT EXISTS (
      SELECT 1 FROM m_menu_access_global g
      WHERE g.role = x.role AND g.menu_code = 'DEALER_LEADS'
  );

CALL RefreshMenuCache();

-- ── 4. Hand the TNPDA Trichy leads to the calling employee ────────────
-- Owner confirmed by the business owner 2026-09-30: DEEPAN-AKMN.
-- Only touches leads that are still unassigned. On a DB where that login
-- does not exist, this updates nothing.
UPDATE t_dealer_lead l
JOIN m_persons p ON p.User_Name = 'DEEPAN-AKMN'
SET l.assigned_to = p.Person_id,
    l.next_followup_date = CURDATE(),
    l.updated_by = 'system',
    l.updation_date = NOW()
WHERE l.event_name = 'TNPDA 2026 - Trichy'
  AND l.assigned_to IS NULL;

-- ── Verify ────────────────────────────────────────────────────────────
SELECT r.role_name, rp.permission_type
FROM m_role_permissions rp JOIN m_roles r ON r.role_id = rp.role_id
WHERE rp.permission_type = 'MANAGE_DEALER_LEADS';

SELECT role, COUNT(*) AS locations FROM user_menu_cache
WHERE url_path = '/dealer-leads/admin' GROUP BY role;

-- expect 39 NEW leads assigned to DEEPAN-AKMN
SELECT p.User_Name, l.status, COUNT(*) AS leads
FROM t_dealer_lead l LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
WHERE l.event_name = 'TNPDA 2026 - Trichy'
GROUP BY p.User_Name, l.status;
