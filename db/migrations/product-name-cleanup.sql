-- Data fix (prod IDs): product names to uppercase with single spaces and no
-- leading/trailing spaces or tabs — the form Products → Add/Edit now saves.
-- Mixed-case / spaced names made price edits fail as a "rename" (AKMN,
-- fixed in code by PR #1150); this tidies the 59 names themselves.
--
-- None of these products is linked to a pump or tank (those join by name);
-- everything else references product_id. Old rows go to m_product_h
-- (operation_type UPDATE).
--
-- Left out until the locations confirm names (two different products would
-- end up with the same name):
--   GAC2  #10434 ADDON DIESEL ₹15   / #10442 "ADDON DIESEL " ₹480
--   MUE   #10256 SSM 20 lit ₹4000   / #10266 "SSM 20 lit<TAB>" ₹2000
--   SAR   #10712 / #10713 (same pair, copied from MUE)
--
-- Guards: a row is renamed only if its name still needs it, it has no pump/
-- tank link, and no other product at the location already has the clean
-- name. Re-runnable.

DROP TEMPORARY TABLE IF EXISTS tmp_name_fix;
CREATE TEMPORARY TABLE tmp_name_fix (product_id INT PRIMARY KEY);
INSERT INTO tmp_name_fix VALUES
    (67),(82),(83),(89),(93),(94),(95),(96),(97),(98),(120),(135),(136),(140),(142),(149),(151),
    (10012),(10013),(10021),(10025),(10037),(10172),(10192),(10193),(10194),(10198),(10208),
    (10230),(10231),(10267),(10281),(10282),(10283),(10284),(10286),(10298),(10304),(10305),
    (10310),(10312),(10359),(10362),(10368),(10389),(10463),(10467),(10468),(10470),(10471),
    (10473),(10496),(10665),(10666),(10667),(10671),(10693),(10694),(10714);

DROP TEMPORARY TABLE IF EXISTS tmp_name_new;
CREATE TEMPORARY TABLE tmp_name_new AS
SELECT p.product_id, p.location_code, p.product_name AS old_name,
       UPPER(TRIM(REGEXP_REPLACE(p.product_name, '[[:space:]]+', ' '))) AS new_name
FROM   m_product p
JOIN   tmp_name_fix t ON t.product_id = p.product_id
WHERE  BINARY p.product_name <> BINARY UPPER(TRIM(REGEXP_REPLACE(p.product_name, '[[:space:]]+', ' ')))
  AND  NOT EXISTS (SELECT 1 FROM m_pump mp WHERE mp.location_code = p.location_code AND mp.product_code = p.product_name)
  AND  NOT EXISTS (SELECT 1 FROM m_tank mt WHERE mt.location_code = p.location_code AND mt.product_code = p.product_name);

-- drop any whose clean name another product already has
DELETE n FROM tmp_name_new n
WHERE EXISTS (SELECT 1 FROM m_product o
              WHERE o.location_code = n.location_code AND o.product_id <> n.product_id
                AND UPPER(TRIM(REGEXP_REPLACE(o.product_name, '[[:space:]]+', ' '))) = n.new_name);

INSERT INTO m_product_h (product_id, product_name, location_code, qty, unit, price,
    created_by, updated_by, updation_date, creation_date, ledger_name,
    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, operation_type)
SELECT p.product_id, p.product_name, p.location_code, p.qty, p.unit, p.price,
    p.created_by, 'SAKTHI', NOW(), p.creation_date, p.ledger_name,
    p.cgst_percent, p.sgst_percent, p.sku_name, p.sku_number, p.hsn_code, p.rgb_color, 'UPDATE'
FROM   m_product p JOIN tmp_name_new n ON n.product_id = p.product_id;

UPDATE m_product p JOIN tmp_name_new n ON n.product_id = p.product_id
SET    p.product_name = n.new_name, p.updated_by = 'SAKTHI', p.updation_date = NOW();

-- ── Verify ─────────────────────────────────────────────────────────────────
SELECT location_code, REPLACE(old_name, '\t', '<TAB>') AS old_name, new_name
FROM   tmp_name_new ORDER BY location_code, new_name;

-- Names still not clean (expect only the 3 pairs above)
SELECT location_code, product_id, REPLACE(product_name, '\t', '<TAB>') AS product_name
FROM   m_product
WHERE  BINARY product_name <> BINARY UPPER(TRIM(REGEXP_REPLACE(product_name, '[[:space:]]+', ' ')));

DROP TEMPORARY TABLE IF EXISTS tmp_name_fix;
DROP TEMPORARY TABLE IF EXISTS tmp_name_new;
