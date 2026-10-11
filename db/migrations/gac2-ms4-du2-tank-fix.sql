-- GAC2: nozzle MS4-DU2 (MS) is linked to TANK-2, an HSD tank.
--
-- *** DO NOT RUN until GAC2 confirms MS4-DU2 draws from TANK-1 (MS) ***
--
-- Set up that way at onboarding (m_pump_tank #173, 03-AUG-2026). The other
-- MS nozzles (MS1-DU1, MS1-DU2, MS4-DU1) are on TANK-1, so TANK-2's figures
-- include MS sales, and a tank fed by two products breaks tank-level stock
-- (generate_closing_stock fails with "more than one row").
--
-- Wrong since onboarding, so the link is corrected in place (no new dated
-- row). The guard matches the current values, so a re-run does nothing.

UPDATE m_pump_tank
SET    tank_id = 64, updated_by = 'SAKTHI'
WHERE  pump_tank_id = 173
  AND  location_code = 'GAC2'
  AND  pump_id = 216
  AND  tank_id = 65;

-- Verify: every GAC2 tank is fed by one product only
SELECT mt.tank_code, mt.product_code AS tank_product,
       GROUP_CONCAT(mp.pump_code ORDER BY mp.pump_code) AS nozzles,
       COUNT(DISTINCT mp.product_code) AS products
FROM   m_pump_tank mpt
JOIN   m_tank mt ON mt.tank_id = mpt.tank_id
JOIN   m_pump mp ON mp.pump_id = mpt.pump_id
WHERE  mt.location_code = 'GAC2'
GROUP  BY mt.tank_code, mt.product_code;
