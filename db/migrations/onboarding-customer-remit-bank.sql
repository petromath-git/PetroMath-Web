-- Add remittance_bank column to onboarding customers
-- (contact detail columns kept in DB for historical data; removed from form)
ALTER TABLE t_onboarding_customers
    ADD COLUMN remittance_bank VARCHAR(200) NULL AFTER gstin;
