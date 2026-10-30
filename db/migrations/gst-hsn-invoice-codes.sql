-- GST Returns: fuel HSN as printed on the oil company's invoices (t_tank_invoice_dtl.hsn_code).
-- IOCL invoices at every outlet: petrol / XP95 / XMS 2710 12 42, diesel / Xtra Green 2710 19 44,
-- diesel in Apr-May 2026 2710 20 10 (biodiesel blend). Fuel products now take the code from their
-- latest invoice; these defaults cover outlets whose invoices carry no code.
-- Descriptions are short placeholders: replace with the portal's text on GST Returns > HSN codes.
-- Safe to run twice. Run after gst-self-filing.sql.

INSERT IGNORE INTO m_gst_hsn (hsn_code, description, created_by) VALUES
('27101242', 'MOTOR SPIRIT (PETROL)', 'system'),
('27101944', 'HIGH SPEED DIESEL OIL', 'system'),
('27102010', 'DIESEL BLENDED WITH BIODIESEL', 'system');

-- Only while the defaults are still the seeded ones (not changed on the HSN page).
UPDATE m_gst_hsn_default SET hsn_code = '27101242'
WHERE category = 'PETROL' AND hsn_code = '27101219' AND updated_by = 'system';
UPDATE m_gst_hsn_default SET hsn_code = '27101944'
WHERE category = 'DIESEL' AND hsn_code = '27101219' AND updated_by = 'system';

-- Check
SELECT * FROM m_gst_hsn_default ORDER BY category;
