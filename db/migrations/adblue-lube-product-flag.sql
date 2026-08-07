-- Data fix: MAK ADBLUE - LOOSE is a metered/tank product (is_tank_product=1) that is
-- also purchased via lube invoices, same pattern as 2T LOOSE (is_tank_product=1 AND
-- is_lube_product=1). It was missing is_lube_product=1, so it never appeared in the
-- Lube Invoice product dropdown (which filters on is_lube_product=1).

UPDATE m_product
SET is_lube_product = 1
WHERE product_name = 'MAK ADBLUE - LOOSE'
  AND is_tank_product = 1
  AND is_lube_product = 0;
