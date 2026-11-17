-- ============================================================
-- IOB PDF bank statement template + link to AMR's IOB account (tkt #462)
-- Generated: 2026-11-17
--
-- Same fixed PDF grid as the other PDF templates (see
-- pdf-bank-statement-templates-ran.sql):
--   A = Txn Date, B = Description, C = Value Date, D = Chq No,
--   E = Debit, F = Credit, G = Balance   (dates always DD/MM/YYYY)
-- bank_name 'IOB PDF' is the parser lookup key in
-- utils/pdf-statement-parsers.js — keep it exactly as below.
--
-- Linking an account to 'IOB PDF' means that account takes the PDF only;
-- the IOB Excel download no longer fits its template. Other IOB accounts
-- stay on the Excel template ('IOB').
--
-- Validated against AMR's statement 01/10/2026–16/10/2026: 54 txns, balance
-- reconciles row by row, totals match the statement summary.
-- ============================================================

INSERT INTO m_bank_statement_template
    (bank_name, template_name, date_column, value_date_column, description_column,
     debit_column, credit_column, balance_column, reference_column,
     header_row, data_start_row, date_format, is_active, created_by)
SELECT 'IOB PDF', 'Indian Overseas Bank (PDF)', 'A', 'C', 'B', 'E', 'F', 'G', 'D', 1, 2, 'DD/MM/YYYY', 1, 'system'
WHERE NOT EXISTS (SELECT 1 FROM m_bank_statement_template WHERE bank_name = 'IOB PDF');

-- AMR: INDIAN OVERSEAS BANK-CURRENT, PERIYASEMUR (134602000009106)
UPDATE m_bank
SET template_id = (SELECT template_id FROM (SELECT template_id FROM m_bank_statement_template WHERE bank_name = 'IOB PDF') t),
    updated_by  = 'tkt462'
WHERE location_code = 'AMR'
  AND account_number = '134602000009106';

-- Expect 1 row.
SELECT b.bank_id, b.location_code, b.bank_name, b.account_number, b.template_id, t.template_name
FROM m_bank b
JOIN m_bank_statement_template t ON t.template_id = b.template_id
WHERE b.location_code = 'AMR'
  AND t.bank_name = 'IOB PDF';
