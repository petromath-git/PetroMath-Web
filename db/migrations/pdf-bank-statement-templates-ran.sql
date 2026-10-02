-- ============================================================
-- PDF bank statement templates (Dhanlaxmi, HDFC, SBI) + link to RAN's accounts
-- Generated: 2026-10-02
--
-- These banks' statements are uploaded as PDF. The upload controller detects
-- a PDF and hands it to utils/pdf-statement-parsers.js, which picks the
-- parser by template bank_name and turns it into a grid with a header row:
--   A = Txn Date, B = Description, C = Value Date, D = RefNo,
--   E = Debit, F = Credit, G = Balance   (dates always DD/MM/YYYY)
-- so header_row / data_start_row / column letters / date_format below are
-- fixed by the parser, not by the PDF layout, and are the same for all three.
--
-- bank_name is the PDF parser lookup key — keep it exactly as below. It is
-- 'HDFC PDF' / 'SBI PDF' (not 'HDFC' / 'SBI') because bank_name is unique and
-- those banks already have Excel templates; only the accounts linked here
-- switch to PDF upload.
--
-- Validated against real RAN statements (26/28-Sep-2026 to 30-Sep-2026); on
-- each, the running balance reconciles row by row from the opening balance
-- and debit/credit counts and totals match the statement summary:
--   Dhanlaxmi  012705300022670   7 txns
--   HDFC       00312000022243   16 txns (password-protected — user enters
--                                         the password on upload)
--   SBI EDFS   33998544214      22 txns (OD account, negative balances)
-- ============================================================

INSERT INTO m_bank_statement_template
    (bank_name, template_name, date_column, value_date_column, description_column,
     debit_column, credit_column, balance_column, reference_column,
     header_row, data_start_row, date_format, is_active, created_by)
VALUES
    ('DHANLAXMI', 'Dhanlaxmi Bank', 'A', 'C', 'B', 'E', 'F', 'G', 'D', 1, 2, 'DD/MM/YYYY', 1, 'system'),
    ('HDFC PDF',  'HDFC Bank (PDF)', 'A', 'C', 'B', 'E', 'F', 'G', 'D', 1, 2, 'DD/MM/YYYY', 1, 'system'),
    ('SBI PDF',   'SBI (PDF)',       'A', 'C', 'B', 'E', 'F', 'G', 'D', 1, 2, 'DD/MM/YYYY', 1, 'system');

-- RAN: DHANLAXMI BANK, PEELAMEDU (012705300022670)
UPDATE m_bank
SET template_id = (SELECT template_id FROM m_bank_statement_template WHERE bank_name = 'DHANLAXMI'),
    updated_by  = 'system'
WHERE bank_id = 83
  AND location_code = 'RAN'
  AND account_number = '012705300022670';

-- RAN: HDFC, TRICHY ROAD (00312000022243)
UPDATE m_bank
SET template_id = (SELECT template_id FROM m_bank_statement_template WHERE bank_name = 'HDFC PDF'),
    updated_by  = 'system'
WHERE location_code = 'RAN'
  AND account_number LIKE '%312000022243';

-- RAN: SBI EDFS, METTUPALAYAM ROAD (33998544214)
UPDATE m_bank
SET template_id = (SELECT template_id FROM m_bank_statement_template WHERE bank_name = 'SBI PDF'),
    updated_by  = 'system'
WHERE location_code = 'RAN'
  AND account_number LIKE '%33998544214';

-- Optional: IFSC on the Dhanlaxmi master (DLXBR000127) doesn't match the
-- statement (DLXB0000127). Uncomment to correct it.
-- UPDATE m_bank SET ifsc_code = 'DLXB0000127', updated_by = 'system'
-- WHERE bank_id = 83 AND location_code = 'RAN' AND ifsc_code = 'DLXBR000127';

-- Expect 3 rows, one per template.
SELECT b.bank_id, b.location_code, b.bank_name, b.account_number, b.template_id, t.template_name
FROM m_bank b
JOIN m_bank_statement_template t ON t.template_id = b.template_id
WHERE b.location_code = 'RAN'
  AND t.bank_name IN ('DHANLAXMI', 'HDFC PDF', 'SBI PDF');
