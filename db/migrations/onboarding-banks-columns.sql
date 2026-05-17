-- Add IFSC code and full account number to onboarding banks table
ALTER TABLE t_onboarding_banks
    ADD COLUMN ifsc_code     VARCHAR(15)  NULL AFTER account_last4,
    ADD COLUMN account_number VARCHAR(30) NULL AFTER ifsc_code;
