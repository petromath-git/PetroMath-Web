-- IOCL distributor lube invoices: supplier SKU -> product links learned from
-- PDFs attached to manually entered invoices (MC/MC2/MME/MUE). Each insert only
-- applies if the product still exists at that location. Safe to re-run.
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:1404184', product_id FROM m_product WHERE product_id = 38 AND location_code = 'MC2';  -- SERVO PRIDE 40-20x1L-HDPE -> PRIDE 40 1LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2503184', product_id FROM m_product WHERE product_id = 37 AND location_code = 'MC2';  -- SERVO GEAR HP 140-20x1L-HDPE -> GEAR 140 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:274850184', product_id FROM m_product WHERE product_id = 10438 AND location_code = 'MC2';  -- SERVO FLEET 20W-40-20 X 1 L -> FLEET 20W40
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2828229', product_id FROM m_product WHERE product_id = 10257 AND location_code = 'MC2';  -- SERVO 4T XTRA-20 X 1 L PROMO -> 4T XTRA 1LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2829229', product_id FROM m_product WHERE product_id = 10257 AND location_code = 'MC2';  -- SERVO 4T XTRA 10W-30-20 X 1 L PROMO -> 4T XTRA 1LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2889156', product_id FROM m_product WHERE product_id = 43 AND location_code = 'MC2';  -- SERVO SCOOTOMATIC 4ST 10W-30-20 X 0.8 L -> 4T SCOOTOMATIC 800ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900125', product_id FROM m_product WHERE product_id = 51 AND location_code = 'MC2';  -- SERVO 2T SUPREME(JFC)-300x40ML-POU -> 2T POUCH
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900174', product_id FROM m_product WHERE product_id = 31 AND location_code = 'MC2';  -- SERVO 2T SUPREME-40X1/2L -> 2T SUPREME 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900184', product_id FROM m_product WHERE product_id = 35 AND location_code = 'MC2';  -- SERVO 2T SUPREME-20 X 1 L -> 2T SUPREME 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900234', product_id FROM m_product WHERE product_id = 52 AND location_code = 'MC2';  -- SERVO 2T SUPREME-4x5L-HDPE -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900401', product_id FROM m_product WHERE product_id = 52 AND location_code = 'MC2';  -- SERVO 2T SUPREME-210 L BRL -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2900403', product_id FROM m_product WHERE product_id = 52 AND location_code = 'MC2';  -- SERVO 2T SUPREME-210 L HD -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2909165', product_id FROM m_product WHERE product_id = 10023 AND location_code = 'MC2';  -- SERVO BRAKE FLUID SUPER HD-20X1/4L-HDP -> BRAKE OIL 250 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2914165', product_id FROM m_product WHERE product_id = 10023 AND location_code = 'MC2';  -- SERVO BRAKE FLUID DOT 4-20 X 1/4 L -> BRAKE OIL 250 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2914175', product_id FROM m_product WHERE product_id = 29 AND location_code = 'MC2';  -- SERVO BRAKE FLUID DOT 4-20 X 1/2 L -> BRAKE OIL 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2924184', product_id FROM m_product WHERE product_id = 40 AND location_code = 'MC2';  -- SERVO 4T-20X1L-HDPE -> 4T 20W40 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2924229', product_id FROM m_product WHERE product_id = 40 AND location_code = 'MC2';  -- SERVO 4T-20 X 1 L HDPE PROMO -> 4T 20W40 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:2931229', product_id FROM m_product WHERE product_id = 41 AND location_code = 'MC2';  -- SERVO 4T 20W-50-20 X 1 L PROMO -> 4T 20W50 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7330242', product_id FROM m_product WHERE product_id = 10039 AND location_code = 'MC2';  -- IOC CLEARBLUE-10 L -> ADBLUE 10LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7330265', product_id FROM m_product WHERE product_id = 178 AND location_code = 'MC2';  -- IOC CLEARBLUE-20 L -> ADBLUE 20LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7485174', product_id FROM m_product WHERE product_id = 30 AND location_code = 'MC2';  -- SERVO SUPER 20W-40 MG-40X1/2L -> SSM 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7485184', product_id FROM m_product WHERE product_id = 34 AND location_code = 'MC2';  -- SERVO SUPER 20W-40 MG-20 X 1 L -> SSM 1LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7494184', product_id FROM m_product WHERE product_id = 34 AND location_code = 'MC2';  -- SERVO SUP. MULT.GRD 20W-40-20 X 1 L -> SSM 1LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC2', 1, 'SKU:7577184', product_id FROM m_product WHERE product_id = 39 AND location_code = 'MC2';  -- SERVO PREMIUM CF-4 15W-40-20X1L-HDPE -> PREMIUM CF-4 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2502184', product_id FROM m_product WHERE product_id = 69 AND location_code = 'MC';  -- SERVO GEAR HP 90-20X1L-HDPE -> GEAR 90 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2502234', product_id FROM m_product WHERE product_id = 86 AND location_code = 'MC';  -- SERVO GEAR HP 90-4x5L-HDPE -> GEAR 90 5 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2503184', product_id FROM m_product WHERE product_id = 70 AND location_code = 'MC';  -- SERVO GEAR HP 140-20x1L-HDPE -> GEAR 140 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:274850183', product_id FROM m_product WHERE product_id = 10558 AND location_code = 'MC';  -- SERVO FLEET 20W-40-1 L -> FLEET 20W-40 1LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:274850184', product_id FROM m_product WHERE product_id = 10558 AND location_code = 'MC';  -- SERVO FLEET 20W-40-20 X 1 L -> FLEET 20W-40 1LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2900125', product_id FROM m_product WHERE product_id = 99 AND location_code = 'MC';  -- SERVO 2T SUPREME(JFC)-300x40ML-POU -> 2T POUCH
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2900174', product_id FROM m_product WHERE product_id = 63 AND location_code = 'MC';  -- SERVO 2T SUPREME-40X1/2L -> 2T SUPREME 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2900184', product_id FROM m_product WHERE product_id = 68 AND location_code = 'MC';  -- SERVO 2T SUPREME-20 X 1 L -> 2T SUPREME 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2900234', product_id FROM m_product WHERE product_id = 92 AND location_code = 'MC';  -- SERVO 2T SUPREME-4x5L-HDPE -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2900401', product_id FROM m_product WHERE product_id = 92 AND location_code = 'MC';  -- SERVO 2T SUPREME-210 L BRL -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2909175', product_id FROM m_product WHERE product_id = 65 AND location_code = 'MC';  -- SERVO BRAKE FLUID SUPER HD-20X1/2L-HDPE -> BREAK FLUID 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2914165', product_id FROM m_product WHERE product_id = 60 AND location_code = 'MC';  -- SERVO BRAKE FLUID DOT 4-20 X 1/4 L LUBE -> BREAK FLIUID 250 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2914175', product_id FROM m_product WHERE product_id = 65 AND location_code = 'MC';  -- SERVO BRAKE FLUID DOT 4-20 X 1/2 L -> BREAK FLUID 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2924181', product_id FROM m_product WHERE product_id = 10028 AND location_code = 'MC';  -- seRVO 4T-1 L PROMO -> 4T 20/40 OIL 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2924229', product_id FROM m_product WHERE product_id = 10028 AND location_code = 'MC';  -- SERVO 4T-20 X 1 L HDPE PROMO -> 4T 20/40 OIL 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2924230', product_id FROM m_product WHERE product_id = 72 AND location_code = 'MC';  -- SERVO 4T-20 X 0.9 L HDPE PROMO -> 4T 20-40 900 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:2949184', product_id FROM m_product WHERE product_id = 76 AND location_code = 'MC';  -- SERVO 4T SYNTH-20 X 1 L -> 4T SYNTH 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:429000184', product_id FROM m_product WHERE product_id = 68 AND location_code = 'MC';  -- SERVO ZOOM 2T SUPREME-20 X 1 L -> 2T SUPREME 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:429000401', product_id FROM m_product WHERE product_id = 92 AND location_code = 'MC';  -- SERVO ZOOM 2T SUPREME-210 L -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:4906184', product_id FROM m_product WHERE product_id = 80 AND location_code = 'MC';  -- SERVO TRANSFLUID A-20X1L-HDPE -> TRANS FLUID 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7330242', product_id FROM m_product WHERE product_id = 10043 AND location_code = 'MC';  -- IOC CLEARBLUE-10 L -> CLEAR BLUE 10 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7485174', product_id FROM m_product WHERE product_id = 62 AND location_code = 'MC';  -- SERVO SUPER 20W-40 MG-40X1/2L -> SSM 20-40 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7485184', product_id FROM m_product WHERE product_id = 66 AND location_code = 'MC';  -- SERVO SUPER 20W-40 MG-20 X 1 L -> SSM 20-40 SUPER 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7485234', product_id FROM m_product WHERE product_id = 82 AND location_code = 'MC';  -- SERVO SUPER 20W-40 MG-4x5L-HDPE -> SSM 20-40 SUPER 5 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7577184', product_id FROM m_product WHERE product_id = 79 AND location_code = 'MC';  -- SERVO PREMIUM CF-4 15W-40-20X1L-HDPE -> PREMIUM CF4 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7577240', product_id FROM m_product WHERE product_id = 85 AND location_code = 'MC';  -- SERVO PREMIUM CF-4 15W-40-4x5L-PROMO -> PREMIUM CF4 5 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7584175', product_id FROM m_product WHERE product_id = 64 AND location_code = 'MC';  -- SERVO KOOL PLUS-20X1/2L-HDPE -> KOOL PLUS 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7584184', product_id FROM m_product WHERE product_id = 78 AND location_code = 'MC';  -- SERVO KOOL PLUS-20X1L-HDPE -> KOOL PLUS 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MC', 4, 'SKU:7705303', product_id FROM m_product WHERE product_id = 106 AND location_code = 'MC';  -- SERVO GREASE MP 3-20 X 1/2 KG CTN -> GREASE 500GM
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2889156', product_id FROM m_product WHERE product_id = 127 AND location_code = 'MME';  -- SERVO SCOOTOMATIC 4ST 10W-30-20 X 0.8 L -> SCOOTMATIC 800 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2900125', product_id FROM m_product WHERE product_id = 152 AND location_code = 'MME';  -- SERVO 2T SUPREME(JFC)-300x40ML-POU -> 2T POUCH
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2900184', product_id FROM m_product WHERE product_id = 121 AND location_code = 'MME';  -- SERVO 2T SUPREME-20 X 1 L -> 2T SUPREME 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2900234', product_id FROM m_product WHERE product_id = 145 AND location_code = 'MME';  -- SERVO 2T SUPREME-4x5L-HDPE -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2900401', product_id FROM m_product WHERE product_id = 145 AND location_code = 'MME';  -- SERVO 2T SUPREME-210 L BRL -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2909175', product_id FROM m_product WHERE product_id = 118 AND location_code = 'MME';  -- SERVO BRAKE FLUID SUPER HD-20X1/2L-HDPE -> BRAKE FLUID 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2924184', product_id FROM m_product WHERE product_id = 10012 AND location_code = 'MME';  -- SERVO 4T-20X1L-HDPE -> 4T 20-40 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2924229', product_id FROM m_product WHERE product_id = 10012 AND location_code = 'MME';  -- SERVO 4T-20 X 1 L HDPE PROMO -> 4T 20-40 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:2924230', product_id FROM m_product WHERE product_id = 125 AND location_code = 'MME';  -- SERVO 4T-20 X 0.9 L HDPE PROMO -> 4T 20-40 900 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:4906184', product_id FROM m_product WHERE product_id = 133 AND location_code = 'MME';  -- SERVO TRANSFLUID A-20X1L-HDPE -> TRANS FLUID 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7330242', product_id FROM m_product WHERE product_id = 10044 AND location_code = 'MME';  -- IOC CLEARBLUE-10 L -> CLEAR BLUE 10 LITS
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7485174', product_id FROM m_product WHERE product_id = 115 AND location_code = 'MME';  -- SERVO SUPER 20W-40 MG-40X1/2L -> SSM 20-40 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7485184', product_id FROM m_product WHERE product_id = 119 AND location_code = 'MME';  -- SERVO SUPER 20W-40 MG-20 X 1 L -> SSM SUPER 20-40 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7485234', product_id FROM m_product WHERE product_id = 135 AND location_code = 'MME';  -- SERVO SUPER 20W-40 MG-4x5L-HDPE -> SSM SUPER 20-40 5 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7577184', product_id FROM m_product WHERE product_id = 132 AND location_code = 'MME';  -- SERVO PREMIUM CF-4 15W-40-20X1L-HDPE -> PREMIUM CF4 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7584184', product_id FROM m_product WHERE product_id = 131 AND location_code = 'MME';  -- SERVO KOOL PLUS-20X1L-HDPE -> KOOL PLUS 1 LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MME', 3, 'SKU:7849341', product_id FROM m_product WHERE product_id = 160 AND location_code = 'MME';  -- SERVO LONG LIFE GREASE-20 KG -> LONG LIFE GREASE 1 KG
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2502184', product_id FROM m_product WHERE product_id = 10210 AND location_code = 'MUE';  -- SERVO GEAR HP 90-20X1L-HDPE -> GEAR 90 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:274850183', product_id FROM m_product WHERE product_id = 10459 AND location_code = 'MUE';  -- SERVO FLEET 20W-40-1 L -> SERVO FLEET 20W40 1L
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:274850184', product_id FROM m_product WHERE product_id = 10459 AND location_code = 'MUE';  -- SERVO FLEET 20W-40-20 X 1 L -> SERVO FLEET 20W40 1L
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2824184', product_id FROM m_product WHERE product_id = 10253 AND location_code = 'MUE';  -- SERVO 4T GREEN-20 X 1 L LUBE -> 4T GREEN
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2828229', product_id FROM m_product WHERE product_id = 10255 AND location_code = 'MUE';  -- SERVO 4T XTRA-20 X 1 L PROMO -> 4T XTRA
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2829229', product_id FROM m_product WHERE product_id = 10255 AND location_code = 'MUE';  -- SERVO 4T XTRA 10W-30-20 X 1 L PROMO -> 4T XTRA
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2889156', product_id FROM m_product WHERE product_id = 10220 AND location_code = 'MUE';  -- SERVO SCOOTOMATIC 4ST 10W-30-20 X 0.8 L -> 4T SCOOTOMATIC 800ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2900125', product_id FROM m_product WHERE product_id = 10228 AND location_code = 'MUE';  -- SERVO 2T SUPREME(JFC)-300x40ML-POU -> 2T POUCH
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2900234', product_id FROM m_product WHERE product_id = 10229 AND location_code = 'MUE';  -- SERVO 2T SUPREME-4x5L-HDPE -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2900403', product_id FROM m_product WHERE product_id = 10229 AND location_code = 'MUE';  -- SERVO 2T SUPREME-210 L HD -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2909165', product_id FROM m_product WHERE product_id = 10240 AND location_code = 'MUE';  -- SERVO BRAKE FLUID SUPER HD-20X1/4L-HDP -> BRAKE OIL 250 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2924184', product_id FROM m_product WHERE product_id = 10217 AND location_code = 'MUE';  -- SERVO 4T-20X1L-HDPE -> 4T 20W40 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2924229', product_id FROM m_product WHERE product_id = 10217 AND location_code = 'MUE';  -- SERVO 4T-20 X 1 L HDPE PROMO -> 4T 20W40 1 LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:2933156', product_id FROM m_product WHERE product_id = 10771 AND location_code = 'MUE';  -- SERVO HONDA SCOOTONXT-20 X 0.8 L -> HONDA SCOOTONXT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:429000401', product_id FROM m_product WHERE product_id = 10229 AND location_code = 'MUE';  -- SERVO ZOOM 2T SUPREME-210 L -> 2T LOOSE
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:7330242', product_id FROM m_product WHERE product_id = 10242 AND location_code = 'MUE';  -- IOC CLEARBLUE-10 L -> ADBLUE 10LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:7330265', product_id FROM m_product WHERE product_id = 10236 AND location_code = 'MUE';  -- IOC CLEARBLUE-20 L -> ADBLUE 20LIT
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:7485174', product_id FROM m_product WHERE product_id = 10207 AND location_code = 'MUE';  -- SERVO SUPER 20W-40 MG-40X1/2L -> SSM 500 ML
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:7485184', product_id FROM m_product WHERE product_id = 10211 AND location_code = 'MUE';  -- SERVO SUPER 20W-40 MG-20 X 1 L -> SSM 1LTR
INSERT IGNORE INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id)
  SELECT 'MUE', 2, 'SKU:7494184', product_id FROM m_product WHERE product_id = 10211 AND location_code = 'MUE';  -- SERVO SUP. MULT.GRD 20W-40-20 X 1 L -> SSM 1LTR
