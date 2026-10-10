-- Data fix: product units are LIT or NOS only (config productUnits).
-- Products, onboarding and Edit Product now pick from that list; older rows
-- carry other spellings:
--   Litres / LITRES / LTS                -> LIT   (64 products, mostly onboarding)
--   Nos (mixed case, onboarding)          -> NOS
--   (BINARY compare: the column collation ignores case)
--   KG / Kgs / 5 KG (grease tins, cylinder) -> NOS (sold by the piece; no
--      purchase lines, prices are per piece)
-- Only the spelling changes; quantities are untouched. Old rows are kept in
-- m_product_h (operation_type UPDATE). Re-runnable.

INSERT INTO m_product_h (product_id, product_name, location_code, qty, unit, price,
    created_by, updated_by, updation_date, creation_date, ledger_name,
    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, operation_type)
SELECT product_id, product_name, location_code, qty, unit, price,
    created_by, 'SAKTHI', NOW(), creation_date, ledger_name,
    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, 'UPDATE'
FROM   m_product
WHERE  BINARY unit NOT IN ('LIT', 'NOS') OR unit IS NULL;

UPDATE m_product
SET    unit = CASE WHEN UPPER(TRIM(unit)) IN ('LIT', 'LITRES', 'LITRE', 'LTS', 'LTR', 'LITERS', 'L') THEN 'LIT' ELSE 'NOS' END,
       updated_by = 'SAKTHI', updation_date = NOW()
WHERE  BINARY unit NOT IN ('LIT', 'NOS') OR unit IS NULL;

-- ── Step 2: packaged lubes are sold by the piece ────────────────────────────
-- 103 lube products (prod IDs) were in litres though they are tins, cans,
-- pouches etc. (1L, 5L, 800ML, D.Water, grease, cylinder refills ...). Their
-- stock and purchases were already counted in pieces, so only the label
-- changes; from now on their sales must be whole numbers.
-- Kept in LIT (user confirmed 2026-10-10): metered lubes, loose 2T / DSR oil,
-- barrel & loose oils at MC/MC2/MME/BAF/AMT, and the fuels set up as lube
-- products (MUE E20, AACBE XP95, HARI HSD XG).
DROP TEMPORARY TABLE IF EXISTS tmp_unit_to_nos;
CREATE TEMPORARY TABLE tmp_unit_to_nos (product_id INT PRIMARY KEY);
INSERT INTO tmp_unit_to_nos VALUES
    (41),(10176),(10190),(10192),(10195),(10196),(10197),(10198),(10199),(10201),(10218),(10245),
    (10253),(10266),(10267),(10274),(10275),(10276),(10277),(10278),(10280),(10281),(10282),(10283),
    (10284),(10286),(10287),(10289),(10290),(10291),(10292),(10293),(10294),(10295),(10296),(10297),
    (10298),(10299),(10300),(10302),(10303),(10304),(10305),(10378),(10391),(10392),(10393),(10394),
    (10395),(10398),(10401),(10402),(10403),(10409),(10487),(10488),(10489),(10490),(10491),(10492),
    (10493),(10494),(10495),(10496),(10497),(10498),(10499),(10500),(10501),(10503),(10506),(10507),
    (10508),(10512),(10578),(10596),(10635),(10636),(10637),(10638),(10639),(10640),(10641),(10642),
    (10643),(10644),(10645),(10646),(10648),(10649),(10650),(10651),(10652),(10653),(10654),(10681),
    (10706),(10710),(10713),(10714),(10741),(10742),(10743);

INSERT INTO m_product_h (product_id, product_name, location_code, qty, unit, price,
    created_by, updated_by, updation_date, creation_date, ledger_name,
    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, operation_type)
SELECT p.product_id, p.product_name, p.location_code, p.qty, p.unit, p.price,
    p.created_by, 'SAKTHI', NOW(), p.creation_date, p.ledger_name,
    p.cgst_percent, p.sgst_percent, p.sku_name, p.sku_number, p.hsn_code, p.rgb_color, 'UPDATE'
FROM   m_product p JOIN tmp_unit_to_nos t ON t.product_id = p.product_id
WHERE  p.unit = 'LIT' AND p.is_lube_product = 1;

UPDATE m_product p JOIN tmp_unit_to_nos t ON t.product_id = p.product_id
SET    p.unit = 'NOS', p.updated_by = 'SAKTHI', p.updation_date = NOW()
WHERE  p.unit = 'LIT' AND p.is_lube_product = 1;

DROP TEMPORARY TABLE IF EXISTS tmp_unit_to_nos;

-- Verify: only LIT and NOS left; lubes still in LIT should be loose/barrel/metered
SELECT unit, COUNT(*) AS products FROM m_product GROUP BY unit;
SELECT location_code, product_name FROM m_product
WHERE  is_lube_product = 1 AND unit = 'LIT' ORDER BY location_code, product_name;
