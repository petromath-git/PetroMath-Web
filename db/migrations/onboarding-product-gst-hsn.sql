-- Add HSN code and GST% columns to onboarding product tables
ALTER TABLE t_onboarding_metered_products
    ADD COLUMN hsn_code     VARCHAR(20)  NULL AFTER short_name,
    ADD COLUMN cgst_percent DECIMAL(5,2) NULL AFTER hsn_code,
    ADD COLUMN sgst_percent DECIMAL(5,2) NULL AFTER cgst_percent;

ALTER TABLE t_onboarding_lubes
    ADD COLUMN hsn_code     VARCHAR(20)  NULL AFTER selling_price,
    ADD COLUMN cgst_percent DECIMAL(5,2) NULL AFTER hsn_code,
    ADD COLUMN sgst_percent DECIMAL(5,2) NULL AFTER cgst_percent;
