-- Add oil company dealer/customer code to m_location
-- IOCL calls this SAP No; BPCL calls it CC No (Customer Code)
-- Used to validate that an uploaded invoice belongs to the correct outlet

ALTER TABLE m_location
    ADD COLUMN oil_co_dealer_code VARCHAR(50) NULL AFTER tin_number;
