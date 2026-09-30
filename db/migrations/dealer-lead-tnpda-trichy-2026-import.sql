-- ============================================================
-- Import 39 handwritten stall leads — TNPDA convention, Trichy,
-- 27-Sep-2026 — into t_dealer_lead.
--
-- Source: notebook pages photographed 30-Sep-2026, transcribed to
-- TNPDA2026-Trichy-PetroMath-Leads.xlsx. The notebook did not always
-- capture bunk name / place / district / oil company / role, all of
-- which are NOT NULL here — those are filled with 'Not noted'.
-- contact_role is 'OTHER' for every row (never recorded).
--
-- New columns:
--   event_name         — which convention/event the lead came from
--   is_priority        — 'Y' where the lead was starred (*) in the notebook
--   needs_verification — what is unreadable in the handwriting (digits,
--                        name, place) — check before calling
--
-- The ALTER is NOT re-runnable (plain ADD COLUMN — IF NOT EXISTS fails on
-- this server). The INSERT is: each row is skipped if an identical
-- (event_name, phone_number, bunk_name, contact_person_name) row exists.
-- ============================================================

ALTER TABLE t_dealer_lead
    ADD COLUMN event_name         VARCHAR(100) NULL AFTER lead_mode,
    ADD COLUMN is_priority        CHAR(1)      NOT NULL DEFAULT 'N' AFTER event_name,
    ADD COLUMN needs_verification VARCHAR(255) NULL AFTER notes;

INSERT INTO t_dealer_lead
    (bunk_name, place, district, phone_number, oil_company, contact_person_name, contact_role,
     lead_mode, event_name, is_priority, generated_by, notes, needs_verification, creation_date)
SELECT s.bunk_name, s.place, s.district, s.phone_number, s.oil_company, s.contact_person_name, 'OTHER',
       'STALL', 'TNPDA 2026 - Trichy', s.is_priority, 'Notebook (manual import)', s.notes, s.needs_verification,
       '2026-09-27 00:00:00'
FROM (
    SELECT 'GRG Fuels' AS bunk_name, 'Not noted' AS place, 'Not noted' AS district, '9047743335' AS phone_number, 'Not noted' AS oil_company, NULL AS contact_person_name, 'N' AS is_priority, '#1. Ref: Karthik Sir' AS notes, 'Bunk name hard to read' AS needs_verification
    UNION ALL SELECT 'Sri Ranganathar Fuels', 'Coimbatore', 'Coimbatore', '9965556553', 'Not noted', NULL, 'Y', '#2', NULL
    UNION ALL SELECT 'Not noted', 'Kambam', 'Theni', '9092105262', 'HPCL', 'Ms. Sujitha', 'Y', '#3', 'Last digit unclear - a 7 is written under it (maybe 9092105267)'
    UNION ALL SELECT 'Not noted', 'Not noted', 'Not noted', '9787177778', 'Not noted', NULL, 'N', '#4. Only a number was written', 'Digits unclear'
    UNION ALL SELECT 'Not noted', 'Krishnagiri', 'Krishnagiri', '9842029616', 'HPCL', 'Saravanan', 'N', '#5', '3rd digit unclear (could be 9642029616)'
    UNION ALL SELECT 'Not noted', 'Namakkal', 'Namakkal', '9597603355', 'Not noted', 'Mr. Raja Sir', 'N', '#6', NULL
    UNION ALL SELECT 'Not noted', 'Karaikudi', 'Sivagangai', '9965531926', 'BPCL', 'Mr. Sai', 'N', '#7', NULL
    UNION ALL SELECT 'Not noted', 'Tindivanam', 'Villupuram', '9894423837', 'Not noted', 'Mr. Karthick', 'N', '#8', NULL
    UNION ALL SELECT 'Not noted', 'Kumuli (?)', 'Not noted', '9025613524', 'Not noted', 'Mr. G. Arul', 'N', '#9', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Tiruvannamalai', 'Tiruvannamalai', '9894493809', 'IOCL', 'Mr. Mohan', 'N', '#10', NULL
    UNION ALL SELECT 'Not noted', 'T.vanam (?)', 'Not noted', '8825936230', 'HPCL', 'Mr. Kavi', 'Y', '#11. Ticked. Needs reports; blue shirt; 3 bunks', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Pudukkottai', 'Pudukkottai', '9600176454', 'IOCL', 'Mr. Mani Sir', 'N', '#12', NULL
    UNION ALL SELECT 'Not noted', 'Tenkasi', 'Tenkasi', '9788749698', 'IOCL', 'Mr. Vijay', 'Y', '#13. Ticked. 4 bunks', NULL
    UNION ALL SELECT 'Sivaraman & Co', 'Thanjavur', 'Thanjavur', '9787855777', 'Not noted', NULL, 'N', '#14', NULL
    UNION ALL SELECT 'Not noted', 'Kanniyakumari (?)', 'Not noted', '7401218180', 'Not noted', 'Ram (?)', 'N', '#15', 'Name, place and first digits unclear'
    UNION ALL SELECT 'Not noted', 'Tirunelveli', 'Tirunelveli', '9442469586', 'HPCL', 'Mr. Bala', 'Y', '#16. Wants reports', NULL
    UNION ALL SELECT 'Not noted', 'Aranthangi (?)', 'Not noted', '9842410432', 'BPCL', 'Mr. Palani Murugan', 'N', '#17. Written as A.Thangi', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Not noted', 'Not noted', '7010713871', 'BPCL', 'Mr. K.R. Muthu (?)', 'N', '#18', 'Name and last digit unclear (1 or 7)'
    UNION ALL SELECT 'Not noted', 'Pudukkottai', 'Pudukkottai', '9842734461', 'IOCL', 'Mr. Thanu Mani (?)', 'N', '#19. Ticked. Another place written and struck out', 'Name hard to read'
    UNION ALL SELECT 'Not noted', 'T.vanam (?)', 'Not noted', '9092034560', 'BPCL / IOCL', 'Mr. Vaidyanathan', 'N', '#20. Ticked. Follow up Oct 1', 'Place hard to read'
    UNION ALL SELECT 'Rasheed Ali & Sons (?)', 'Not noted', 'Not noted', '8925753552', 'IOCL', NULL, 'N', '#21. An earlier number was struck out', 'Bunk name hard to read'
    UNION ALL SELECT 'Not noted', 'Pandalam (?)', 'Not noted', '9443126885', 'HPCL', NULL, 'N', '#22. Ticked. Wants reports', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Trichy (?)', 'Tiruchirappalli (?)', '9443494859', 'HPCL', NULL, 'N', '#23. Wants reports', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Sivagangai', 'Sivagangai', '9842162613', 'BPCL', 'R. Udhayakumar', 'N', '#24. Ticked', NULL
    UNION ALL SELECT 'Naga Agency (?)', 'Sivagangai', 'Sivagangai', '9443126867', 'BPCL', NULL, 'N', '#25. Ticked', 'Bunk name hard to read'
    UNION ALL SELECT 'Not noted', 'Virudhunagar (?)', 'Virudhunagar (?)', '9842466627', 'BPCL', 'Mr. Thangaraj', 'N', '#26. Ticked', 'Place written as V.Nagar'
    UNION ALL SELECT 'PSV FS', 'Perambalur', 'Perambalur', '984155143?', 'Not noted', NULL, 'N', '#27', 'Last digit overwritten'
    UNION ALL SELECT 'Boopathi Agencies', 'Pirappanvalasai', 'Ramanathapuram', '9442433540', 'Not noted', NULL, 'N', '#28', NULL
    UNION ALL SELECT 'Not noted', 'Gobi (?)', 'Erode (?)', '8056988662', 'IOCL', 'Mr. Ilayavan', 'Y', '#29', 'Place hard to read'
    UNION ALL SELECT 'Not noted', 'Not noted', 'Not noted', '9943344544', 'IOCL', 'R. Ponnuraj (?)', 'N', '#30', 'Name hard to read'
    UNION ALL SELECT 'Not noted', 'J.Kondam (?)', 'Not noted', '984257?555', 'Not noted', 'Mr. Deva Sir', 'N', '#31', 'Digits 7-8 overwritten; place unclear'
    UNION ALL SELECT 'Sri Durga Agencies', 'Dindigul', 'Dindigul', '8220330263', 'BPCL', 'Mr. Jaffar Sir', 'N', '#32. Ticked. He is an app developer', NULL
    UNION ALL SELECT 'Sri Raman Agencies', 'Trichy', 'Tiruchirappalli', '8973786113', 'Not noted', NULL, 'N', '#33', NULL
    UNION ALL SELECT 'Sri Veera Agencies', 'Oddanchatram', 'Dindigul', '9965546188', 'IOCL', NULL, 'N', '#34', NULL
    UNION ALL SELECT 'Sri Vanji Amman', 'Oddanchatram', 'Dindigul', '9443340304', 'IOCL', NULL, 'N', '#35', NULL
    UNION ALL SELECT 'Not noted', 'Mettupalayam', 'Coimbatore', '', 'Not noted', 'Mr. Rashid Sir', 'N', '#36. Ref: Prabhu Sir', 'No phone number written'
    UNION ALL SELECT 'Not noted', 'Tiruppur', 'Tiruppur', '9944122466', 'HPCL', 'Mr. Siva Sir', 'Y', '#37. BPCL written and struck out', NULL
    UNION ALL SELECT 'Not noted', 'Pudukkottai', 'Pudukkottai', '9095857495', 'BPCL', 'Mr. Dhanush', 'N', '#38', NULL
    UNION ALL SELECT 'Not noted', 'Hosur', 'Krishnagiri', '9443377750', 'IOCL', 'Mr. Althaf', 'N', '#39', NULL
) s
WHERE NOT EXISTS (
    SELECT 1 FROM t_dealer_lead d
    WHERE d.event_name = 'TNPDA 2026 - Trichy'
      AND d.phone_number = s.phone_number
      AND d.bunk_name = s.bunk_name
      AND d.contact_person_name <=> s.contact_person_name
);

-- ── Verify — expect 39 rows, 7 priority ──────────────────────────────
SELECT COUNT(*) AS total, SUM(is_priority = 'Y') AS priority, SUM(needs_verification IS NOT NULL) AS to_verify
FROM t_dealer_lead
WHERE event_name = 'TNPDA 2026 - Trichy';
