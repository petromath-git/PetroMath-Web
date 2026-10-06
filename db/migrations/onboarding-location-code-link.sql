-- Links an onboarding to the PetroMath location it was migrated into.
-- Migrate uses it to tell a safe re-run (code already linked to this
-- onboarding) from a clash (code belongs to another, live station), and
-- refuses the clash instead of grafting this RO's masters onto that station.
-- UNIQUE so two onboardings can never claim the same code (NULLs allowed).
ALTER TABLE t_onboarding
    ADD COLUMN location_code VARCHAR(50) NULL AFTER location_name,
    ADD UNIQUE KEY uq_onboarding_location_code (location_code);

-- Backfill onboardings already migrated before this column existed, so a
-- re-run on them isn't blocked. Each row is guarded by id AND name, so a
-- mismatched id on another environment updates nothing.
UPDATE t_onboarding SET location_code = 'GAC2' WHERE id = 5  AND location_name = 'Ashok - Gounder Agencies';
UPDATE t_onboarding SET location_code = 'BAF'  WHERE id = 7  AND location_name = 'Balaa Fuels';
UPDATE t_onboarding SET location_code = 'PAC'  WHERE id = 9  AND location_name = 'Pariyur corporation';
UPDATE t_onboarding SET location_code = 'HKSK' WHERE id = 10 AND location_name = 'Haryana KSK';
UPDATE t_onboarding SET location_code = 'SMA'  WHERE id = 14 AND location_name = 'SHRIMADHI - NAGAPATTINAM';
UPDATE t_onboarding SET location_code = 'DIV'  WHERE id = 15 AND location_name = 'Divij Krishna Agecies';
UPDATE t_onboarding SET location_code = 'RAN'  WHERE id = 16 AND location_name = 'Sri Ranganathar Fuels Coimbatore';
UPDATE t_onboarding SET location_code = 'AMR'  WHERE id = 17 AND location_name = 'AMR-Erode';
UPDATE t_onboarding SET location_code = 'SEN'  WHERE id = 18 AND location_name = 'SENTHIL ANDAVAR FUELS, SATTUR,VIRUDHUNAGAR';
UPDATE t_onboarding SET location_code = 'AMT'  WHERE id = 21 AND location_name = 'Amarnath Fuels Gobi';
