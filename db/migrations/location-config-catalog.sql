-- Description catalog for m_location_config settings.
--
-- m_location_config stores one row per (location_code, setting_name, effective_date_range),
-- so a description does not belong on that table -- the same setting_name can appear dozens
-- of times (per-location overrides, history rows). This catalog holds ONE row per setting_name
-- with a short + detailed description, editable independently of any config value.
--
-- Run once per environment. Safe to re-run (CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE
-- KEY UPDATE), so re-running after adding/adjusting descriptions below is fine.

CREATE TABLE IF NOT EXISTS m_location_config_catalog (
    setting_name          VARCHAR(50)  NOT NULL PRIMARY KEY,
    short_description     VARCHAR(255) NULL,
    detailed_description  TEXT         NULL,
    created_by             VARCHAR(45)  NULL,
    updated_by             VARCHAR(45)  NULL,
    creation_date          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updation_date          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Backfill: drafted from grepping every getLocationConfigValue()/getSetting()/raw-SQL call site
-- as of 2026-08-06. Review the detailed_description column and correct anything that doesn't
-- match actual intent -- these were inferred from usage, not written by the feature owner.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
-- Shift closing / operations
('ALLOW_SHIFT_REOPEN', 'Allow reopening a closed shift',
 'Y/N. When Y, a completed shift closing at this location can be reopened for correction instead of staying locked. Checked in closing-edit-controller.js and home-controller.js.',
 'system', 'system'),

('MAX_DAYS_ALLOWED_BACK_DATE_CLOSING', 'Max days a shift closing can be backdated',
 'Number of days in the past a shift closing date is allowed to be set to when creating/editing a closing. Checked in home-controller.js, closing-edit-controller.js, bill-controller.js.',
 'system', 'system'),

('PUMP_OPENING_READING_READONLY', 'Lock pump opening reading field',
 'Y/N. When Y, the pump opening meter reading field on the shift closing screen is read-only and auto-carried from the previous closing instead of being editable.',
 'system', 'system'),

('SHOW_2T_SALES_TAB', 'Show 2T oil sales tab on shift closing',
 'Y/N. Controls whether the separate 2T (two-stroke) oil sales tab appears on the shift closing screen. Default N; some legacy locations (e.g. carried-over GAC2) run Y.',
 'system', 'system'),

('ALLOW_QUICK_ADD_VEHICLE', 'Enable quick-add vehicle modal',
 'Y/N. Enables the "+" button next to the vehicle dropdown in the credit tab that opens a modal to add a new vehicle inline (AJAX POST /vehicles/api/quick-add) without leaving the closing screen. Default disabled.',
 'system', 'system'),

('CASHFLOW_ENABLED', 'Enable cashflow-based closing workflow',
 'Y/N (or true/false in some call sites -- inconsistent, worth standardizing). Gates whether the location uses the cashflow closing workflow (t_cashflow_closing) in addition to/instead of plain shift closing. Checked in reports-dsr-controller.js, bank-statement-dao.js, credit-receipts-dao.js, txn-tankrcpt-dao.js.',
 'system', 'system'),

-- Bowser
('ALLOW_BOWSER_REOPEN', 'Allow reopening a closed bowser closing',
 'Y/N. When Y, a completed bowser closing can be reopened for correction. Checked in bowser-controller.js.',
 'system', 'system'),

('BOWSER_CLOSING_BACKDATE_DAYS', 'Max days a bowser closing can be backdated',
 'Number of days in the past a bowser closing date can be set to. Checked in bowser-controller.js alongside ALLOW_BOWSER_REOPEN.',
 'system', 'system'),

-- Employee
('EMPLOYEE_AUTO_SALARY', 'Auto-generate employee salary entries',
 'Y/N. When Y, salary ledger entries are auto-generated for employees rather than requiring manual entry. Checked in employee-controller.js.',
 'system', 'system'),

('EMPLOYEE_LEDGER_BACKDATE_DAYS', 'Max days an employee ledger entry can be backdated',
 'Number of days in the past an employee ledger entry\'s date can be set to when creating one. 0 = no restriction on backdating.',
 'system', 'system'),

('EMPLOYEE_LEDGER_DELETE_DAYS', 'Max days after creation an employee ledger entry can be deleted',
 'An employee ledger entry can only be deleted within this many days of its creation date. Prevents deleting old/reconciled entries.',
 'system', 'system'),

('DOC_MAX_UPLOAD_MB', 'Max document upload size (MB)',
 'Maximum file size in megabytes accepted for document uploads (e.g. employee documents stored in t_document_store). Default 2.',
 'system', 'system'),

-- Credit statement / reports
('CREDIT_STMT_SHOW_PERIOD_SUMMARY', 'Show period summary on credit statement',
 'Y/N. Shows/hides the period summary block on the credit statement and credit ledger reports. Default Y.',
 'system', 'system'),

('CREDIT_STMT_SHOW_STATEMENT_NUMBER', 'Show sequential statement number',
 'Y/N. Shows an auto-generated sequential statement number on the credit statement. Requires the t_credit_statement numbering migration to be in place. Default N.',
 'system', 'system'),

('CREDIT_STMT_BALANCE_CRDR_FORMAT', 'Format balance as DR/CR',
 'Y/N. When Y, the balance column on the credit statement is displayed as "1,234.56 DR/CR" instead of a plain signed number. Default N.',
 'system', 'system'),

('CREDIT_STMT_SHOW_BALANCE', 'Show balance column on credit statement',
 'Y/N. Shows/hides the Balance column entirely on the credit statement. Default Y.',
 'system', 'system'),

('CREDIT_STMT_SHOW_CUSTOMER_INFO', 'Show customer info block on credit statement',
 'Y/N. Shows/hides the customer info block (address, contact, etc.) on the credit statement. Default N.',
 'system', 'system'),

('ENABLE_CREDIT_REPORT_EXCEL_DOWNLOAD', 'Enable Excel download on credit reports',
 'Y/N. Shows/hides the Excel download button on credit reports. Default N.',
 'system', 'system'),

-- Bank / oil company statement
('ALLOW_MANUAL_BANK_TRANSACTIONS', 'Allow manually adding bank transactions',
 'Y/N. Allows manually adding a bank transaction row rather than only importing from a bank statement file. Checked in bank-statement-controller.js and oil-company-statement-controller.js.',
 'system', 'system'),

('ALLOW_BANK_RECLASSIFY', 'Allow reclassifying bank transactions',
 'Y/N. Allows changing the classification/head of an already-imported bank transaction.',
 'system', 'system'),

('ALLOW_BANK_SPLIT', 'Allow splitting a bank transaction',
 'Y/N (some call sites compare to the string \'true\' rather than \'Y\' -- worth normalizing). Allows splitting a single bank transaction across multiple accounting heads. Checked in transaction-upload-controller.js, bank-statement-controller.js.',
 'system', 'system'),

('ALLOW_OIL_RECLASSIFY', 'Allow reclassifying oil company statement transactions',
 'Y/N. Allows changing the classification of an oil company statement transaction, same pattern as ALLOW_BANK_RECLASSIFY but for oil-company-statement-controller.js.',
 'system', 'system'),

-- Bill numbering
('BILL_PREFIX_CREDIT', 'Credit bill number prefix',
 'Prefix string prepended to credit sale bill numbers. Used by bill-numbering-service.js.',
 'system', 'system'),

('BILL_PREFIX_CASH', 'Cash bill number prefix',
 'Prefix string prepended to cash sale bill numbers. Used by bill-numbering-service.js.',
 'system', 'system'),

('BILL_SUFFIX_CREDIT', 'Credit bill number suffix',
 'Suffix string appended to credit sale bill numbers. Used by bill-numbering-service.js.',
 'system', 'system'),

('BILL_SUFFIX_CASH', 'Cash bill number suffix',
 'Suffix string appended to cash sale bill numbers. Used by bill-numbering-service.js.',
 'system', 'system'),

('BILL_NUMBER_PADDING', 'Bill number zero-padding width',
 'Number of digits the numeric part of a bill number is zero-padded to (e.g. 6 -> 000123). Default 6.',
 'system', 'system'),

('BILL_RESET_FREQUENCY', 'Bill number sequence reset frequency',
 'How often the bill number sequence resets back to the starting number, e.g. FINANCIAL_YEAR. Used by bill-numbering-service.js.',
 'system', 'system'),

('BILL_INCLUDE_YEAR', 'Include year in bill number',
 'true/false. Whether the financial/calendar year is embedded in the generated bill number.',
 'system', 'system'),

('BILL_YEAR_FORMAT', 'Bill number year format',
 'Format of the year embedded in the bill number when BILL_INCLUDE_YEAR is enabled, e.g. YY or YYYY.',
 'system', 'system'),

('BILL_CREDIT_START_NUMBER', 'Credit bill starting number',
 'The number the credit bill sequence starts counting from (or resets to). Default 0.',
 'system', 'system'),

('BILL_CASH_START_NUMBER', 'Cash bill starting number',
 'The number the cash bill sequence starts counting from (or resets to). Default 0.',
 'system', 'system'),

('BILL_UNIFIED_SEQUENCE', 'Use one bill sequence for cash and credit',
 'true/false. When true, cash and credit sales share a single unified bill number sequence instead of separate credit/cash sequences.',
 'system', 'system'),

('BILL_UNIFIED_PREFIX', 'Unified bill number prefix',
 'Prefix used for the unified bill number sequence when BILL_UNIFIED_SEQUENCE is enabled.',
 'system', 'system'),

('BILL_UNIFIED_SUFFIX', 'Unified bill number suffix',
 'Suffix used for the unified bill number sequence when BILL_UNIFIED_SEQUENCE is enabled.',
 'system', 'system'),

('BILL_UNIFIED_START_NUMBER', 'Unified bill sequence starting number',
 'The number the unified bill sequence starts counting from (or resets to) when BILL_UNIFIED_SEQUENCE is enabled. Default 0.',
 'system', 'system'),

-- GL accounting / Day bill
('GL_ACCOUNTING_ENABLED', 'Enable GL accounting engine for this location',
 'Y/N. Gate checked by the is_gl_accounting_enabled() DB function -- accounting event triggers (CREDIT_SALE, CASH_SALE, DAY_BILL, TANK_INVOICE, LUBES_INVOICE, BOWSER, etc.) only fire when this is Y for the location (or globally via location_code=''*''). See docs/gl-accounting-design.md.',
 'system', 'system'),

('GL_LOG_LEVEL', 'GL batch run log verbosity',
 'DEBUG, INFO, or ERROR. Controls verbosity of Create Accounting / Generate Events batch run logs. DEBUG = per-event detail, INFO = summaries + errors, ERROR = errors only. Default INFO.',
 'system', 'system'),

('DAY_BILL_CONSOLIDATE_THRESHOLD', 'Day bill consolidation revenue threshold',
 'Decimal amount. When a vendor/product day bill total for the day is below this threshold, it is consolidated into a single-product (dominant product) bill rather than itemized. Default 20000.',
 'system', 'system'),

-- Purchases
('FUEL_INVOICE_EDIT_DISABLED', 'Disable editing fuel purchase invoices',
 'Y/N. When Y, fuel purchase invoices at this location cannot be edited after creation. Checked in purchases-controller.js.',
 'system', 'system'),

-- System / misc
('DEBUG_LOGGING', 'Enable verbose backend debug logging',
 'Y/N. Enables verbose backend debug logging for this location (utils/debug-logger.js). Can also be forced on via the DEBUG_LOGGING=true environment variable regardless of this setting.',
 'system', 'system'),

('DESKTOP_ZOOM', 'Desktop layout zoom factor',
 'Decimal CSS zoom factor (e.g. 0.8) applied to the desktop layout for this location. Temporary display-density tuning knob (see app.js comment) -- intended to be removed once zoom is finalized and baked into style.css.',
 'system', 'system'),

('CUSTOMER_DEFAULT_PASSWORD', 'Default password for auto-created customer portal logins',
 'Default password assigned when a customer portal login is auto-created for a credit customer (e.g. via the "Create Login" action or onboarding). Falls back to a global (*) default if no location-specific value is set.',
 'system', 'system'),

('TALLY_EXPORT_VERSION', 'Tally export format version [DEPRECATED]',
 'v1 or v2. Selected which Tally export format a location uses. Tally export is being decommissioned -- do not build on this further; retained only for locations still using the legacy export.',
 'system', 'system')

ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = VALUES(updated_by),
    updation_date          = CURRENT_TIMESTAMP;
