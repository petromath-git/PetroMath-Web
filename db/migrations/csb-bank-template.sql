-- Add support for single-amount-column banks (e.g. CSB Bank)
-- where one column holds the amount and another column says "Credit" or "Debit"
ALTER TABLE m_bank_statement_template
  ADD COLUMN transaction_type_column VARCHAR(5) DEFAULT NULL
    COMMENT 'Column letter for Credit/Debit type indicator. Set when the bank uses a single Amount column instead of separate Debit/Credit columns.';

-- CSB Bank statement template
-- Format: Transaction Date(A), Description(B), Reference(C), Type(D), Amount(E), Balance(F)
-- Data starts at row 30 (29 header/account-detail rows + 1 column-header row)
-- Date format: DD/MM/YY (e.g. 06/04/26)
-- Amount format: "INR 6,039.00" — handled by parseAmount() in the controller
INSERT INTO m_bank_statement_template (
    template_name,
    bank_name,
    date_column,
    value_date_column,
    debit_column,
    credit_column,
    description_column,
    reference_column,
    balance_column,
    transaction_type_column,
    data_start_row,
    date_format,
    is_active
) VALUES (
    'CSB Bank',
    'CSB Bank',
    'A',
    NULL,
    'E',
    'E',
    'B',
    'C',
    'F',
    'D',
    30,
    'DD/MM/YY',
    1
);
