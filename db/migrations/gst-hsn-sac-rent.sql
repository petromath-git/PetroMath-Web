-- GST Returns: SAC for rent invoices (Transactions > Rental Invoices) in GSTR-1 Table 12.
-- Safe to run twice. Run after gst-self-filing.sql.

INSERT IGNORE INTO m_gst_hsn (hsn_code, description, created_by) VALUES
('997212', 'Rental or leasing services involving own or leased non-residential property', 'system');

-- Check
SELECT hsn_code, description FROM m_gst_hsn WHERE hsn_code = '997212';
