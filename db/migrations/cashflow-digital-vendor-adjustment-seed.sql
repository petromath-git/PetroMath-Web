-- ============================================================
-- Cashflow -> Auto Digital-Vendor Debit Adjustment: BAF seed data
-- Generated: 2026-09-03
--
-- Adds the "Cash Against Digital Vendor" outflow Account Head for
-- Balaa Fuels (BAF) only, wires it into the Cashflow OutFlow
-- dropdown via a Static m_ledger_rules row, and turns on the
-- feature flag. Other locations are untouched - the Account Head
-- simply doesn't exist for them, so the new dropdown option and
-- vendor picker never appear.
--
-- Guarded with NOT EXISTS throughout, safe to re-run.
-- ============================================================

-- Step 1: Account Head
INSERT INTO m_account_heads
    (location_code, account_head_name, allowed_entry_type, requires_digital_vendor_link,
     is_system_type, effective_start_date, created_by, updated_by)
SELECT 'BAF', 'Cash Against Digital Vendor', 'DEBIT', 'Y', 'N', CURDATE(), 'MIGRATION', 'MIGRATION'
WHERE NOT EXISTS (
    SELECT 1 FROM m_account_heads
    WHERE location_code = 'BAF' AND account_head_name = 'Cash Against Digital Vendor'
);

-- Step 2: cashflow-scoped Static ledger rule (makes it show up in the OutFlow dropdown)
INSERT INTO m_ledger_rules
    (location_code, source_type, external_id, ledger_name, allowed_entry_type,
     applies_to_cashflow, display_sequence, created_by, updated_by)
SELECT mah.location_code, 'Static', mah.account_head_id, mah.account_head_name,
       mah.allowed_entry_type, 'Y', 160, 'MIGRATION', 'MIGRATION'
FROM m_account_heads mah
WHERE mah.location_code = 'BAF' AND mah.account_head_name = 'Cash Against Digital Vendor'
  AND NOT EXISTS (
      SELECT 1 FROM m_ledger_rules mlr
      WHERE mlr.location_code = mah.location_code AND mlr.external_id = mah.account_head_id
        AND mlr.source_type = 'Static' AND mlr.applies_to_cashflow = 'Y'
  );

-- Step 3: feature flag
INSERT INTO m_location_config
    (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by)
SELECT 'BAF', 'ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT', 'Y', CURDATE(), '9999-12-31', 'MIGRATION', 'MIGRATION'
WHERE NOT EXISTS (
    SELECT 1 FROM m_location_config
    WHERE location_code = 'BAF' AND setting_name = 'ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT'
);

-- Verify
SELECT account_head_id, account_head_name, requires_digital_vendor_link FROM m_account_heads
WHERE location_code = 'BAF' AND account_head_name = 'Cash Against Digital Vendor';
SELECT rule_id, external_id, ledger_name, applies_to_cashflow, display_sequence FROM m_ledger_rules
WHERE location_code = 'BAF' AND ledger_name = 'Cash Against Digital Vendor';
SELECT config_id, location_code, setting_name, setting_value FROM m_location_config
WHERE location_code = 'BAF' AND setting_name = 'ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT';
