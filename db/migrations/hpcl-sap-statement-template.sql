-- ============================================================
-- HPCL SAP dealer statement template (HPCL-SOA accounts)
-- Generated: 2026-10-08
--
-- Validated against a real HPCL "ret_report.xls" (customer 244 / R034,
-- 01-Sep-2026 to 30-Sep-2026): 144 transactions parsed, totals match the
-- statement (Dr 2,73,08,535.93 / Cr 2,69,03,017.69, closing 3,12,322.38).
--
-- The file is an HTML table saved as .xls; the upload controller routes it
-- through parseHtmlXlsToData, which emits one row per <tr>:
--   row 1-4  customer code, period, "TRANSACTION DETAILS", opening balance
--   row 5    header: Sl.No | C.R/Invoice Reference | C.R/Invoice Date |
--            Invoice Type | Cheque No./DD No. | Segment | Due Date |
--            Dr Amount | Cr Amount | Payer Details | Parent Details
--   row 6+   transactions, interleaved with "Day Closing Balance" rows
--            (no date in column C, so they are skipped)
--
-- Date = C (C.R/Invoice Date). Column G (Due Date) is NOT used: lube
-- invoices carry a due date a month later.
-- Credits are shown as negatives ("-430,000") and empty amounts as "-";
-- relies on the controller taking the absolute value of debit/credit.
-- Description "B,D,E" = doc number + invoice type + narration, which keeps
-- recurring same-amount lines (daily TDS, HP Pay settlements) distinct for
-- duplicate detection. Requires the multi-column description support in
-- transaction-upload-controller.js.
-- No running balance per row, so balance_column is blank (same as BPCL).
-- ============================================================

INSERT INTO m_bank_statement_template
    (bank_name, template_name, date_column, value_date_column, description_column,
     debit_column, credit_column, balance_column, reference_column,
     header_row, data_start_row, date_format, is_active, created_by)
VALUES
    ('HPCL', 'HPCL SAP Dealer Statement', 'C', NULL, 'B,D,E',
     'H', 'I', '', 'B',
     5, 6, 'DD/MM/YYYY', 1, 'system');

SET @hpcl_template_id = LAST_INSERT_ID();

-- SHA: HPCL-SOA (validated with SHA's statement). AND is also HPCL but is
-- left unlinked until one of its statements has been checked.
UPDATE m_bank
SET template_id = @hpcl_template_id,
    updated_by  = 'system'
WHERE bank_id = 94
  AND location_code = 'SHA'
  AND bank_name = 'HPCL-SOA'
  AND template_id IS NULL;

SELECT b.bank_id, b.location_code, b.bank_name, b.template_id, t.template_name
FROM m_bank b
JOIN m_bank_statement_template t ON t.template_id = b.template_id
WHERE b.bank_name = 'HPCL-SOA';
