-- ============================================================
-- KVB (Karur Vysya Bank) bank statement template + link to BAF's KVB account
-- Generated: 2026-09-25
--
-- Validated against a real BAF statement (01-Sep-2026 to 24-Sep-2026,
-- "CASA Statement - EXCEL Format"): 148 transactions parsed, B/F row skipped,
-- 0 date mismatches, running balance reconciles on every row.
--
-- Row numbers are relative to the sheet's used range, which is how the upload
-- controller reads it (sheet_to_json header:1). KVB's range starts at A3, so
-- the header shown in Excel on row 17 is row 15 here, and data starts at 16
-- (the B/F row, which has '-' amounts and is skipped).
--
-- Value Date (B) is used for txn date; Transaction Date (A) carries a time
-- suffix ("01-SEP-2026 03:09:23") and would not match DD-MMM-YYYY.
--
-- NOTE: KVB downloads are password-protected (password = KVB Customer ID).
-- The upload controller can't read encrypted files yet, so until the
-- password-on-upload feature ships, users must remove the password in Excel
-- before uploading.
-- ============================================================

INSERT INTO m_bank_statement_template
    (bank_name, template_name, date_column, value_date_column, description_column,
     debit_column, credit_column, balance_column, reference_column,
     header_row, data_start_row, date_format, is_active, created_by)
VALUES
    ('KVB', 'KVB CASA Statement', 'A', 'B', 'C',
     'E', 'F', 'G', 'D',
     15, 16, 'DD-MMM-YYYY', 1, 'system');

SET @kvb_template_id = LAST_INSERT_ID();

-- BAF: THE KARUR VYSYA BANK LTD, KOMBAI
UPDATE m_bank
SET template_id = @kvb_template_id,
    updated_by  = 'system'
WHERE bank_id = 64
  AND location_code = 'BAF';

-- Optional: account number on the master (1148155000003522) doesn't match the
-- statement (1148135000003522). Uncomment once confirmed with the customer.
-- UPDATE m_bank SET account_number = '1148135000003522', updated_by = 'system'
-- WHERE bank_id = 64 AND location_code = 'BAF' AND account_number = '1148155000003522';

SELECT b.bank_id, b.bank_name, b.account_number, b.template_id, t.template_name
FROM m_bank b
JOIN m_bank_statement_template t ON t.template_id = b.template_id
WHERE b.bank_id = 64;
