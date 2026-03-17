-- ============================================================
-- tally_export_v2
--
-- Changes from tally_export:
--   1. Cash sales read from t_day_bill_items (CASH header, non-GST only)
--      instead of recalculating from pump readings on the fly.
--      PREREQUISITE: generate_day_bill must be run for all dates in range.
--
--   2. cur_digital_sales + cur_digital_product_allocation REMOVED.
--      Replaced by cur_digital_bill_items which reads DIGITAL headers
--      from t_day_bill and creates direct entries:
--        Vendor DR / Product Sales Ledger CR
--      The DIGITAL SALE ACCOUNT intermediate ledger is no longer needed.
--
--   3. Consolidation logic (small vendor → single dominant product) is
--      now correctly reflected in Tally entries since the Day Bill
--      already computed the correct split.
--
--   4. XML templates cleaned:
--      - Removed obsolete VAT/CST/FBT era tags
--      - Removed hardcoded ALTERID/MASTERID/VOUCHERKEY
--      - Removed empty/no-op elements (GUID, GSTCLASS, REMOVEZEROENTRIES, etc.)
--      - Removed dead templates: xml_data_segment_bank,
--        xml_data_segment_expense, xml_data_segment_gst_MC
--
--   5. Non-GST sales bills (credit, suspense, cash) converted to
--      Accounting Voucher View — no ALLINVENTORYENTRIES.LIST.
--      Product / qty / price info moved into NARRATION.
--      GST bills (2T oil) keep inventory entries (needed for CGST/SGST).
--
--   6. t_2toil no longer queried directly in tally_export_v2.
--      2T oil is read from the Day Bill CASH header (cgst_rate > 0).
--      The pre-calculated taxable_amount / cgst_amount / sgst_amount
--      from t_day_bill_items replace the hardcoded 18% recalculation.
--
-- Safe to run multiple times: DROP FUNCTION IF EXISTS guards the create.
-- To activate: update the two DAO calls from tally_export → tally_export_v2
--   dao/utilities-dao.js       line: SELECT tally_export(...)
--   dao/tally-daybook-dao.js   line: SELECT tally_export(...)
-- ============================================================

DELIMITER ;;

DROP FUNCTION IF EXISTS `tally_export_v2` ;;

CREATE DEFINER=`petromath_prod`@`%` FUNCTION `tally_export_v2`(
    p_closing_date  DATE,
    p_location_code VARCHAR(10),
    p_mode          VARCHAR(10)
) RETURNS MEDIUMTEXT CHARSET latin1
BEGIN

-- ── Variable declarations ─────────────────────────────────────────────────
DECLARE xml_template_data_start       TEXT;
DECLARE xml_template_data_end         TEXT;
DECLARE xml_data_segment_temp         MEDIUMTEXT;
DECLARE xml_data_segment              TEXT;  -- non-GST sales, accounting-only
DECLARE xml_data_segment_gst          TEXT;  -- GST sales with inventory
DECLARE xml_data_segment_receipt      TEXT;
DECLARE xml_data_segment_journal      TEXT;
DECLARE xml_data_segment_cashflow_exp TEXT;
DECLARE xml_data_segment_cashflow_receipt TEXT;
DECLARE xml_data_segment_debitbankV2  TEXT;
DECLARE xml_data_segment_creditbankV2 TEXT;
DECLARE xml_data_segment_iocl_pur     TEXT;

DECLARE l_bill_no           VARCHAR(20);
DECLARE l_unit              VARCHAR(20);
DECLARE l_invoice_num       VARCHAR(20);
DECLARE l_notes             VARCHAR(300);
DECLARE l_exp               VARCHAR(300);
DECLARE l_trans_ledger_name VARCHAR(300);
DECLARE l_company_name      VARCHAR(300);
DECLARE l_product_name      VARCHAR(100);
DECLARE l_price             DECIMAL(10,2);
DECLARE l_amt               DECIMAL(10,2);
DECLARE l_tcs_dedecuted_amt DECIMAL(10,2);
DECLARE l_qty               DECIMAL(10,3);
DECLARE l_gst_amount        DECIMAL(10,2);
DECLARE l_cgst_amount       DECIMAL(10,2);
DECLARE l_cgst_rate         DECIMAL(5,2);
DECLARE l_tcs_amt           DECIMAL(10,2);
DECLARE l_iocl_rate         DECIMAL(10,2);
DECLARE l_bfrgst            DECIMAL(10,2);
DECLARE l_tran_date         VARCHAR(50);
DECLARE l_tran_date1        VARCHAR(50);
DECLARE l_bank_trans_date   VARCHAR(50);
DECLARE l_narration         VARCHAR(1000);
DECLARE l_tally_output      LONGTEXT;
DECLARE l_ledger_name       VARCHAR(100);
DECLARE l_temp_table_id     DECIMAL(20,0);
DECLARE l_seq               INT DEFAULT 0;
DECLARE l_debit_amount      DECIMAL(10,2);
DECLARE l_credit_amount     DECIMAL(10,2);
DECLARE l_contra_ledger     VARCHAR(100);
DECLARE exit_loop           BOOLEAN DEFAULT FALSE;

-- ── Cursor declarations ───────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 1. NON-GST CREDIT BILLS
--    Individual credit customer fuel sales (HSD, MS, etc.)
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_non_gst_credit_bills CURSOR FOR
SELECT
    tc.bill_no,
    tc.notes,
    mcl.company_name,
    mp.product_name,
    tc.price,
    ROUND(tc.amount, 2)                        AS amt,
    tc.qty,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')    AS tran_date1,
    mp.ledger_name
FROM t_credits tc
JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
JOIN m_product     mp  ON tc.product_id    = mp.product_id
JOIN t_closing     tcl ON tc.closing_id    = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mcl.type          = 'Credit'
  AND mp.cgst_percent   <= 0
ORDER BY tc.bill_no;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. NON-GST SUSPENSE BILLS (posted as Cash in Tally)
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_non_gst_suspense_bills CURSOR FOR
SELECT
    tc.bill_no,
    mcl.company_name                           AS notes,
    'Cash'                                     AS company_name,
    mp.product_name,
    tc.price,
    ROUND(tc.amount, 2)                        AS amt,
    tc.qty,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')    AS tran_date1,
    mp.ledger_name
FROM t_credits tc
JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
JOIN m_product     mp  ON tc.product_id    = mp.product_id
JOIN t_closing     tcl ON tc.closing_id    = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mcl.type          = 'Suspense'
  AND mp.cgst_percent   <= 0
ORDER BY tc.bill_no;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. NON-GST CASH SALES (t_cashsales, cgst_percent = 0)
--    Individual cash invoices for non-GST pump products (HSD, MS, etc.)
--    These are deducted from pump readings in generate_day_bill so they
--    do NOT appear in cur_cash_bill_items — they need their own cursor.
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_non_gst_cashsales CURSOR FOR
SELECT
    tc.bill_no,
    ''             AS notes,
    'Cash'         AS company_name,
    mp.product_name,
    ROUND(SUM(tc.amount) / NULLIF(SUM(tc.qty), 0), 2)  AS price,
    ROUND(SUM(tc.amount), 2)                             AS amt,
    SUM(tc.qty)                                          AS qty,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')            AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')              AS tran_date1,
    mp.ledger_name
FROM t_cashsales tc
JOIN m_product mp  ON tc.product_id = mp.product_id
JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mp.cgst_percent   <= 0
GROUP BY mp.product_name, tcl.closing_date, tc.bill_no, mp.ledger_name
ORDER BY tc.bill_no;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. GST PRODUCT BILLS
--    Manual GST cash sales (t_cashsales) + GST credit + GST suspense.
--    2T oil (LOOSE + POUCH) removed — now read from Day Bill via
--    cur_gst_cash_bill_items below.
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_gst_product_bills CURSOR FOR

-- Manual cash sales from t_cashsales (GST products only)
SELECT
    tc.bill_no,
    'Cash'         AS company_name,
    mp.product_name,
    mp.unit,
    SUM(tc.qty)    AS qty,
    SUM(tc.amount) AS amt,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')    AS tran_date1,
    mp.ledger_name,
    mp.cgst_percent
FROM t_cashsales tc
JOIN m_product mp  ON tc.product_id = mp.product_id
JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mp.cgst_percent   > 0
GROUP BY mp.product_name, tcl.closing_date, tc.bill_no, mp.unit, mp.ledger_name, mp.cgst_percent

UNION ALL

-- GST credit sales
SELECT
    tc.bill_no,
    mcl.company_name,
    mp.product_name,
    mp.unit,
    tc.qty,
    ROUND(tc.amount, 2) AS amt,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')    AS tran_date1,
    mp.ledger_name,
    mp.cgst_percent
FROM t_credits tc
JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
JOIN m_product     mp  ON tc.product_id    = mp.product_id
JOIN t_closing     tcl ON tc.closing_id    = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mcl.type          = 'Credit'
  AND mp.cgst_percent   > 0

UNION ALL

-- GST suspense sales (posted as Cash in Tally)
SELECT
    tc.bill_no,
    'Cash'         AS company_name,
    mp.product_name,
    mp.unit,
    tc.qty,
    ROUND(tc.amount, 2) AS amt,
    DATE_FORMAT(tcl.closing_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(tcl.closing_date, '%Y%m%d')    AS tran_date1,
    mp.ledger_name,
    mp.cgst_percent
FROM t_credits tc
JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
JOIN m_product     mp  ON tc.product_id    = mp.product_id
JOIN t_closing     tcl ON tc.closing_id    = tcl.closing_id
WHERE DATE(tcl.closing_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tcl.location_code = p_location_code
  AND mcl.type          = 'Suspense'
  AND mp.cgst_percent   > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. CASH BILL ITEMS  (NEW — replaces cur_collection_bills)
--    Reads non-GST pump products from the Day Bill CASH header.
--    cgst_rate = 0 filter ensures 2T oil stays in cur_gst_product_bills.
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_cash_bill_items CURSOR FOR
SELECT
    COALESCE(NULLIF(dbh.bill_number, ''),
             CONCAT('CASH-', DATE_FORMAT(db.bill_date, '%d%m%y'))) AS bill_no,
    p.product_name,
    p.ledger_name,
    dbi.quantity,
    dbi.rate,
    dbi.total_amount,
    DATE_FORMAT(db.bill_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(db.bill_date, '%Y%m%d')    AS tran_date1
FROM t_day_bill        db
JOIN t_day_bill_header dbh ON db.day_bill_id = dbh.day_bill_id
JOIN t_day_bill_items  dbi ON dbh.header_id  = dbi.header_id
JOIN m_product         p   ON dbi.product_id = p.product_id
WHERE db.location_code  = p_location_code
  AND DATE(db.bill_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND db.status          = 'ACTIVE'
  AND dbh.bill_type      = 'CASH'
  AND dbi.cgst_rate      = 0        -- GST products handled by cur_gst_product_bills
  AND dbi.total_amount   > 0
ORDER BY db.bill_date, p.product_name;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. GST CASH BILL ITEMS  (NEW — replaces t_2toil unions)
--    Reads 2T oil (and any future GST pump products) from Day Bill CASH header.
--    cgst_rate > 0 filter picks these up.
--    All GST amounts are pre-calculated by generate_day_bill — no hardcoded
--    18% recalculation needed.
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_gst_cash_bill_items CURSOR FOR
SELECT
    COALESCE(NULLIF(dbh.bill_number, ''),
             CONCAT('CASH-', DATE_FORMAT(db.bill_date, '%d%m%y'))) AS bill_no,
    'Cash'                                 AS company_name,
    p.product_name,
    p.unit,
    dbi.quantity,
    dbi.total_amount,
    dbi.taxable_amount,
    dbi.cgst_amount,
    p.ledger_name,
    DATE_FORMAT(db.bill_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(db.bill_date, '%Y%m%d')    AS tran_date1
FROM t_day_bill        db
JOIN t_day_bill_header dbh ON db.day_bill_id = dbh.day_bill_id
JOIN t_day_bill_items  dbi ON dbh.header_id  = dbi.header_id
JOIN m_product         p   ON dbi.product_id = p.product_id
WHERE db.location_code  = p_location_code
  AND DATE(db.bill_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND db.status          = 'ACTIVE'
  AND dbh.bill_type      = 'CASH'
  AND dbi.cgst_rate      > 0        -- GST products (2T oil etc.)
  AND dbi.total_amount   > 0
ORDER BY db.bill_date, p.product_name;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. DIGITAL BILL ITEMS  (NEW — replaces cur_digital_sales + cur_digital_product_allocation)
--    Reads from Day Bill DIGITAL headers.
--    Creates direct entries: Vendor DR / Product Sales Ledger CR
--    No DIGITAL SALE ACCOUNT intermediate ledger needed.
--    Consolidation logic (small vendor → dominant product) is already
--    baked into the Day Bill — reflected here automatically.
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_digital_bill_items CURSOR FOR
SELECT
    COALESCE(NULLIF(cl.ledger_name, ''), cl.company_name) AS vendor_ledger,
    cl.company_name                                        AS vendor_name,
    p.ledger_name                                          AS sales_ledger,
    p.product_name,
    dbi.quantity,
    dbi.rate,
    dbi.total_amount,
    DATE_FORMAT(db.bill_date, '%d-%b-%Y')  AS tran_date,
    DATE_FORMAT(db.bill_date, '%Y%m%d')    AS tran_date1
FROM t_day_bill        db
JOIN t_day_bill_header dbh ON db.day_bill_id = dbh.day_bill_id
JOIN t_day_bill_items  dbi ON dbh.header_id  = dbi.header_id
JOIN m_product         p   ON dbi.product_id = p.product_id
JOIN m_credit_list     cl  ON dbh.vendor_id  = cl.creditlist_id
WHERE db.location_code  = p_location_code
  AND DATE(db.bill_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND db.status          = 'ACTIVE'
  AND dbh.bill_type      = 'DIGITAL'
  AND dbi.total_amount   > 0
ORDER BY db.bill_date, cl.company_name, p.product_name;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. CUSTOMER RECEIPTS (cash)
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_receipts CURSOR FOR
SELECT
    tr.receipt_no,
    mcl.company_name,
    tr.amount,
    CONCAT(tr.notes, tr.receipt_type)      AS notes,
    DATE_FORMAT(tr.receipt_date, '%Y%m%d') AS tran_date1
FROM t_receipts    tr
JOIN m_credit_list mcl ON tr.creditlist_id = mcl.creditlist_id
WHERE tr.location_code = p_location_code
  AND DATE(tr.receipt_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND mcl.type        = 'Credit'
  AND tr.receipt_type = 'Cash';

-- ─────────────────────────────────────────────────────────────────────────
-- 8. CASHFLOW EXPENSES / INCOME
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_cashflow CURSOR FOR
SELECT
    tct.amount,
    DATE_FORMAT(tc.cashflow_date, '%Y%m%d') AS trans_date,
    CONCAT(tct.type, '  - ', tct.description,
           '       ****PM CASHFLOW', tct.transaction_id, '****') AS narration,
    CASE WHEN ml.tag = 'OUT' THEN 'Y' ELSE 'N' END AS exp_flag,
    CASE
        WHEN LOWER(tct.description) LIKE '%tea%'
          OR LOWER(tct.description) LIKE '%tiffin%' THEN 'TEA COFFEE EXPENSES'
        ELSE IFNULL(ml.attribute5, 'GENERAL EXPENSES')
    END AS ledger
FROM t_cashflow_closing     tc
JOIN t_cashflow_transaction tct ON tct.cashflow_id  = tc.cashflow_id
JOIN m_lookup               ml  ON tct.type         = ml.description
WHERE tc.cashflow_date BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tc.location_code  = p_location_code
  AND ml.lookup_type    = 'CashFlow'
  AND tct.amount        > 0
  AND tc.location_code  = ml.location_code
  AND ml.tally_export   = 'Y'
  AND NOT (tct.type IN ('Cashier A/C (+)', 'Cashier A/C (-)')
           AND tct.calc_flag = 'Y');

-- ─────────────────────────────────────────────────────────────────────────
-- 9. BANK DEBIT TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_bank_debit_transactionv2 CURSOR FOR
SELECT
    DATE_FORMAT(tbt.trans_date, '%Y%m%d') AS trans_date,
    tbt.debit_amount                      AS amount,
    mb.ledger_name,
    CASE
        WHEN tbt.ledger_name IS NULL          THEN 'PETROMATH SUSPENSE'
        WHEN UPPER(tbt.ledger_name) = 'OTHERS' THEN 'PETROMATH SUSPENSE'
        ELSE tbt.ledger_name
    END AS transaction_ledger_name,
    CONCAT(ml.description, '  - ', tbt.remarks,
           '       ****PM', tbt.t_bank_id, '****', mb.bank_name) AS narration
FROM t_bank_transaction tbt
JOIN m_bank   mb ON tbt.bank_id      = mb.bank_id
JOIN m_lookup ml ON ml.lookup_id     = tbt.transaction_type
WHERE tbt.debit_amount  > 0
  AND tbt.closed_flag   = 'Y'
  AND DATE(tbt.trans_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND mb.location_code  = p_location_code
  -- Skip intra-bank transfers and oil company payment mirrors
  -- (tagged at entry time; immune to ledger name renames)
  AND IFNULL(tbt.external_source, '') != 'Bank'
  -- Skip unclassified oil company entries (fuel invoices reconciled via t_tank_stk_rcpt)
  AND NOT (
    mb.is_oil_company = 'Y'
    AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 10. BANK CREDIT TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_bank_credit_transactionv2 CURSOR FOR
SELECT
    DATE_FORMAT(tbt.trans_date, '%Y%m%d') AS trans_date,
    tbt.credit_amount                     AS amount,
    mb.ledger_name,
    CASE
        WHEN IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS') THEN 'PETROMATH SUSPENSE'
        ELSE tbt.ledger_name
    END AS transaction_ledger_name,
    CONCAT(ml.description, '  - ', tbt.remarks,
           '       ****PM', tbt.t_bank_id, '****', mb.account_nickname) AS narration
FROM t_bank_transaction tbt
JOIN m_bank   mb ON tbt.bank_id      = mb.bank_id
JOIN m_lookup ml ON ml.lookup_id     = tbt.transaction_type
WHERE tbt.credit_amount > 0
  AND tbt.closed_flag   = 'Y'
  AND DATE(tbt.trans_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND mb.location_code  = p_location_code
  -- Skip intra-bank transfers and oil company payment mirrors
  -- (tagged at entry time; immune to ledger name renames)
  AND IFNULL(tbt.external_source, '') != 'Bank'
  -- Skip unclassified oil company entries (payment mirrors not yet backfilled)
  AND NOT (
    mb.is_oil_company = 'Y'
    AND IFNULL(tbt.ledger_name, '') IN ('', 'OTHERS')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 11. IOCL STOCK RECEIPTS (fuel purchases)
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_iocl_purchase CURSOR FOR
SELECT
    CASE
        WHEN mt.product_code = 'MS'   THEN 'PETROL PURCHASE ACCOUNT'
        WHEN mt.product_code = 'HSD'  THEN 'DIESEL PURCHASE ACCOUNT'
        WHEN mt.product_code = 'XMS'  THEN 'XTRA PREMIUM PETROL PURCHASE ACCOUNT'
        WHEN mt.product_code = 'XP95' THEN 'XTRA PREMIUM PETROL PURCHASE ACCOUNT'
        WHEN mt.product_code = 'GD'   THEN 'GREEN DIESEL PURCHASE ACCOUNT'
        WHEN mt.product_code = 'E20'  THEN 'E20 PURCHASE ACCOUNT'
        ELSE 'PETROMATH SUSPENSE'
    END AS ledger,
    SUM(quantity) * 1000  AS qty,
    SUM(amount)           AS amt,
    mt.product_code,
    tr.invoice_number,
    DATE_FORMAT(tr.invoice_date, '%Y%m%d') AS trans_date
FROM t_tank_stk_rcpt_dtl td
JOIN t_tank_stk_rcpt tr ON tr.ttank_id     = td.ttank_id
JOIN m_tank          mt ON td.tank_id      = mt.tank_id
WHERE tr.location_code  = p_location_code
  AND tr.invoice_date   BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND tr.closing_status = 'CLOSED'
GROUP BY mt.product_code, tr.invoice_date, tr.invoice_number
ORDER BY tr.invoice_number;

-- ─────────────────────────────────────────────────────────────────────────
-- 12. ADJUSTMENTS (payment gateway charges, reversals, etc.)
-- ─────────────────────────────────────────────────────────────────────────
DECLARE cur_adjustments CURSOR FOR
SELECT
    ta.adjustment_id,
    CASE
        WHEN ta.external_source IN ('CUSTOMER','DIGITAL_VENDOR')
            THEN COALESCE(NULLIF(mcl.ledger_name, ''), mcl.company_name)
        WHEN ta.external_source = 'SUPPLIER' THEN ms.supplier_name
        WHEN ta.external_source = 'BANK'     THEN mb.ledger_name
        ELSE 'PETROMATH SUSPENSE'
    END AS ledger_name,
    'PETROMATH SUSPENSE'          AS contra_ledger,
    COALESCE(ta.debit_amount,  0) AS debit_amount,
    COALESCE(ta.credit_amount, 0) AS credit_amount,
    DATE_FORMAT(ta.adjustment_date, '%d-%b-%Y') AS tran_date,
    DATE_FORMAT(ta.adjustment_date, '%Y%m%d')   AS tran_date1,
    CONCAT(ta.adjustment_type, ' - ', COALESCE(ta.description, ''),
           ' Ref: ', COALESCE(ta.reference_no, ''),
           ' ****PM ADJ', ta.adjustment_id, '****') AS notes
FROM t_adjustments ta
LEFT JOIN m_credit_list mcl ON ta.external_id = mcl.creditlist_id
                            AND ta.external_source IN ('CUSTOMER','DIGITAL_VENDOR')
LEFT JOIN m_supplier    ms  ON ta.external_id = ms.supplier_id
                            AND ta.external_source = 'SUPPLIER'
LEFT JOIN m_bank        mb  ON ta.external_id = mb.bank_id
                            AND ta.external_source = 'BANK'
WHERE DATE(ta.adjustment_date) BETWEEN p_closing_date AND LAST_DAY(p_closing_date)
  AND ta.location_code = p_location_code
  AND ta.status        = 'ACTIVE'
  AND (ta.debit_amount > 0 OR ta.credit_amount > 0)
ORDER BY ta.adjustment_date, ta.adjustment_id;

DECLARE CONTINUE HANDLER FOR NOT FOUND SET exit_loop = TRUE;

-- ═════════════════════════════════════════════════════════════════════════
-- XML TEMPLATES (cleaned up)
-- ═════════════════════════════════════════════════════════════════════════

-- ── Envelope wrappers ─────────────────────────────────────────────────────
SET xml_template_data_start =
    "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC>
<REPORTNAME>All Masters</REPORTNAME>
<STATICVARIABLES>
<SVCURRENTCOMPANY>PETROMATH</SVCURRENTCOMPANY>
</STATICVARIABLES>
</REQUESTDESC>
<REQUESTDATA>";

SET xml_template_data_end = "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";

-- ── Non-GST sales: accounting-only (no inventory entries) ─────────────────
-- Used by: credit bills, suspense bills, cash bill items, digital bill items
-- Product / qty / price info is in the NARRATION.
SET xml_data_segment =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Sales' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«bill_no» | «product» «qty»L @ «price» | «notes»</NARRATION>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>«bill_no»</VOUCHERNUMBER>
<PARTYLEDGERNAME>«ledger»</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«salesledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>No</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── GST sales: invoice view with inventory (needed for CGST/SGST lines) ───
-- Used by: 2T oil, other GST products (cash / credit / suspense)
SET xml_data_segment_gst =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Sales' ACTION='Create' OBJVIEW='Invoice Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>BILL NO : «bill_no»</NARRATION>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VOUCHERNUMBER>«bill_no»</VOUCHERNUMBER>
<PARTYLEDGERNAME>«ledger»</PARTYLEDGERNAME>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<PLACEOFSUPPLY>Tamil Nadu</PLACEOFSUPPLY>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ISINVOICE>Yes</ISINVOICE>
<LEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
<BASICRATEOFINVOICETAX.LIST TYPE='Number'>
<BASICRATEOFINVOICETAX>9</BASICRATEOFINVOICETAX>
</BASICRATEOFINVOICETAX.LIST>
<ROUNDTYPE>Upward Rounding</ROUNDTYPE>
<LEDGERNAME>9% CGST</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>No</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«gstamount»</AMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
<BASICRATEOFINVOICETAX.LIST TYPE='Number'>
<BASICRATEOFINVOICETAX>9</BASICRATEOFINVOICETAX>
</BASICRATEOFINVOICETAX.LIST>
<ROUNDTYPE>Upward Rounding</ROUNDTYPE>
<LEDGERNAME>9 % SGST</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>No</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«gstamount»</AMOUNT>
</LEDGERENTRIES.LIST>
<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>«product»</STOCKITEMNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<RATE>«price»/«unit»</RATE>
<AMOUNT>«bfrgstamount»</AMOUNT>
<VATASSBLVALUE>«bfrgstamount»</VATASSBLVALUE>
<ACTUALQTY> «qty» «unit»</ACTUALQTY>
<BILLEDQTY> «qty» «unit»</BILLEDQTY>
<BATCHALLOCATIONS.LIST>
<GODOWNNAME>Main Location</GODOWNNAME>
<BATCHNAME>Primary Batch</BATCHNAME>
<AMOUNT>«bfrgstamount»</AMOUNT>
<ACTUALQTY> «qty» «unit»</ACTUALQTY>
<BILLEDQTY> «qty» «unit»</BILLEDQTY>
</BATCHALLOCATIONS.LIST>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>«salesledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>No</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«bfrgstamount»</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Customer receipt ──────────────────────────────────────────────────────
SET xml_data_segment_receipt =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Receipt' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
<PARTYLEDGERNAME>«ledger»</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>Cash</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Journal ───────────────────────────────────────────────────────────────
-- Used by: IOCL-bank matching, adjustments
SET xml_data_segment_journal =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Journal' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledgerfrom»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Cashflow payment (expense out) ────────────────────────────────────────
SET xml_data_segment_cashflow_exp =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Payment' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
<PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>Cash</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Cashflow receipt (income in) ──────────────────────────────────────────
SET xml_data_segment_cashflow_receipt =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Receipt' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
<PARTYLEDGERNAME>Cash</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>Cash</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Bank debit (Payment voucher) ──────────────────────────────────────────
SET xml_data_segment_debitbankV2 =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Payment' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
<PARTYLEDGERNAME>«ledger»</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledgerfrom»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
<BANKALLOCATIONS.LIST>
<DATE>«dateformatted»</DATE>
<INSTRUMENTDATE>«dateformatted»</INSTRUMENTDATE>
<TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE>
<PAYMENTFAVOURING>«ledgerfrom»</PAYMENTFAVOURING>
<CHEQUECROSSCOMMENT>A/c Payee</CHEQUECROSSCOMMENT>
<STATUS>No</STATUS>
<PAYMENTMODE>Transacted</PAYMENTMODE>
<BANKPARTYNAME>«ledgerfrom»</BANKPARTYNAME>
<AMOUNT>«amount»</AMOUNT>
</BANKALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── Bank credit (Receipt voucher) ────────────────────────────────────────
SET xml_data_segment_creditbankV2 =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Receipt' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<NARRATION>«notes»</NARRATION>
<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
<PARTYLEDGERNAME>«ledger»</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledgerfrom»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
<BANKALLOCATIONS.LIST>
<DATE>«dateformatted»</DATE>
<INSTRUMENTDATE>«dateformatted»</INSTRUMENTDATE>
<TRANSACTIONTYPE>Cheque/DD</TRANSACTIONTYPE>
<TRANSFERMODE>NEFT</TRANSFERMODE>
<STATUS>No</STATUS>
<PAYMENTMODE>Transacted</PAYMENTMODE>
<AMOUNT>-«amount»</AMOUNT>
</BANKALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ── IOCL stock receipt (Purchase voucher with inventory) ─────────────────
SET xml_data_segment_iocl_pur =
"<TALLYMESSAGE xmlns:UDF='TallyUDF'>
<VOUCHER VCHTYPE='Purchase' ACTION='Create' OBJVIEW='Accounting Voucher View'>
<DATE>«dateformatted»</DATE>
<REFERENCEDATE>«dateformatted»</REFERENCEDATE>
<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
<NARRATION>IOCL Invoice Num: «invoice_num»</NARRATION>
<REFERENCE>«invoice_num»</REFERENCE>
<PARTYLEDGERNAME>INDIANOIL CORPORATION LIMITED</PARTYLEDGERNAME>
<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
<EFFECTIVEDATE>«dateformatted»</EFFECTIVEDATE>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>INDIANOIL CORPORATION LIMITED</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
<AMOUNT>«amount»</AMOUNT>
</ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>«ledger»</LEDGERNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<AMOUNT>-«amount»</AMOUNT>
<INVENTORYALLOCATIONS.LIST>
<STOCKITEMNAME>«product_name»</STOCKITEMNAME>
<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
<RATE>«rate»/LIT</RATE>
<AMOUNT>-«amount»</AMOUNT>
<ACTUALQTY> «qty» LIT</ACTUALQTY>
<BILLEDQTY> «qty» LIT</BILLEDQTY>
<BATCHALLOCATIONS.LIST>
<GODOWNNAME>Main Location</GODOWNNAME>
<BATCHNAME>Primary Batch</BATCHNAME>
<AMOUNT>-«amount»</AMOUNT>
<ACTUALQTY> «qty» LIT</ACTUALQTY>
<BILLEDQTY> «qty» LIT</BILLEDQTY>
</BATCHALLOCATIONS.LIST>
</INVENTORYALLOCATIONS.LIST>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>";

-- ═════════════════════════════════════════════════════════════════════════
-- MAIN PROCESSING
-- ═════════════════════════════════════════════════════════════════════════

IF p_mode IS NULL THEN
    SET p_mode = 'EXPORT';
END IF;

SELECT CONCAT(
    DATE_FORMAT(NOW(6), '%y%m%d%H%i%S'),
    LPAD(CRC32(p_location_code) % 1000, 3, '0')
) INTO l_temp_table_id;

SET SESSION group_concat_max_len = 100000000;

DELETE FROM t_temp_xml_table;

INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Start tally_export_v2');

SET l_seq = l_seq + 1;
INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
VALUES (l_temp_table_id, p_location_code, xml_template_data_start, l_seq);

-- ══════════════════════════════════════════════════════════════════════════
-- 1. NON-GST CREDIT BILLS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_non_gst_credit_bills;

non_gst_credit_loop: LOOP
    FETCH cur_non_gst_credit_bills INTO
        l_bill_no, l_notes, l_company_name, l_product_name,
        l_price, l_amt, l_qty, l_tran_date, l_tran_date1, l_ledger_name;

    IF exit_loop THEN
        CLOSE cur_non_gst_credit_bills;
        LEAVE non_gst_credit_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Credit', l_ledger_name, l_company_name, l_amt, l_notes, l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',      l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_notes);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',      l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',        l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',          l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',  l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP non_gst_credit_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. NON-GST SUSPENSE BILLS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_non_gst_suspense_bills;

non_gst_suspense_loop: LOOP
    FETCH cur_non_gst_suspense_bills INTO
        l_bill_no, l_notes, l_company_name, l_product_name,
        l_price, l_amt, l_qty, l_tran_date, l_tran_date1, l_ledger_name;

    IF exit_loop THEN
        CLOSE cur_non_gst_suspense_bills;
        LEAVE non_gst_suspense_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Credit', l_ledger_name, l_company_name, l_amt, l_notes, l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',      l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_notes);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',      l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',        l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',          l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',  l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP non_gst_suspense_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. NON-GST CASH SALES (individual cash invoices for fuel — t_cashsales)
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_non_gst_cashsales;

non_gst_cashsales_loop: LOOP
    FETCH cur_non_gst_cashsales INTO
        l_bill_no, l_notes, l_company_name, l_product_name,
        l_price, l_amt, l_qty, l_tran_date, l_tran_date1, l_ledger_name;

    IF exit_loop THEN
        CLOSE cur_non_gst_cashsales;
        LEAVE non_gst_cashsales_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Cash', l_ledger_name, l_company_name, l_amt, l_notes, l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',       l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',         l_notes);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',        l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',       l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',         l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',        l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',           l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',   l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP non_gst_cashsales_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. GST PRODUCT BILLS (GST cash / credit / suspense)
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before GST product bills');

OPEN cur_gst_product_bills;

gst_product_loop: LOOP
    FETCH cur_gst_product_bills INTO
        l_bill_no, l_company_name, l_product_name, l_unit,
        l_qty, l_amt, l_tran_date, l_tran_date1, l_ledger_name, l_cgst_rate;

    IF exit_loop THEN
        CLOSE cur_gst_product_bills;
        LEAVE gst_product_loop;
    END IF;

    -- Use actual rate from m_product (cgst = sgst, so total GST = 2 * cgst_rate)
    SET l_gst_amount  = l_amt - (l_amt * (100 / (100 + l_cgst_rate + l_cgst_rate)));
    SET l_cgst_amount = l_gst_amount / 2;
    SET l_bfrgst      = l_amt - l_cgst_amount - l_cgst_amount;
    SET l_price       = l_bfrgst / l_qty;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Cash', l_ledger_name, l_company_name, l_amt,
            CONCAT('Product - ', l_product_name, ' - Quantity - ', l_qty), l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment_gst;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',       l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',        l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',       l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«unit»',          l_unit);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',         l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',        l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',           l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«gstamount»',     l_cgst_amount);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bfrgstamount»',  l_bfrgst);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',   l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP gst_product_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. GST CASH BILL ITEMS  (from Day Bill — 2T oil and any GST pump products)
--    Replaces the t_2toil unions. Amounts come pre-calculated from Day Bill.
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before GST cash bill items (day bill)');

OPEN cur_gst_cash_bill_items;

gst_cash_bill_loop: LOOP
    FETCH cur_gst_cash_bill_items INTO
        l_bill_no, l_company_name, l_product_name, l_unit,
        l_qty, l_amt, l_bfrgst, l_cgst_amount,
        l_ledger_name, l_tran_date, l_tran_date1;

    IF exit_loop THEN
        CLOSE cur_gst_cash_bill_items;
        LEAVE gst_cash_bill_loop;
    END IF;

    -- Price for the RATE tag is the exclusive (pre-tax) price per unit
    SET l_price = l_bfrgst / l_qty;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Cash', l_ledger_name, l_company_name, l_amt,
            CONCAT('Product - ', l_product_name, ' - Quantity - ', l_qty), l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment_gst;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',       l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',        l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',       l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«unit»',          l_unit);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',         l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',        l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',           l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«gstamount»',     l_cgst_amount);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bfrgstamount»',  l_bfrgst);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',   l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP gst_cash_bill_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. CASH BILL ITEMS  (from Day Bill — non-GST pump products only)
--    Replaces cur_collection_bills.
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before cash bill items (day bill)');

OPEN cur_cash_bill_items;

cash_bill_loop: LOOP
    FETCH cur_cash_bill_items INTO
        l_bill_no, l_product_name, l_ledger_name,
        l_qty, l_price, l_amt, l_tran_date, l_tran_date1;

    IF exit_loop THEN
        CLOSE cur_cash_bill_items;
        LEAVE cash_bill_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Cash', l_ledger_name, 'Cash', l_amt,
            CONCAT('Cash Bill - ', l_product_name, ' ', l_qty, 'L @ ', l_price), l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',      l_bill_no);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        '');
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       'Cash');
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',      l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',        l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',          l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',  l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP cash_bill_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. DIGITAL BILL ITEMS  (from Day Bill)
--    Replaces cur_digital_sales + cur_digital_product_allocation.
--    Vendor DR / Product Sales Ledger CR  (direct — no intermediate account)
--    Uses the same xml_data_segment (accounting Sales voucher).
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before digital bill items (day bill)');

OPEN cur_digital_bill_items;

digital_bill_loop: LOOP
    -- l_company_name = vendor_ledger (party to DEBIT)
    -- l_notes        = vendor_name   (human-readable, for narration)
    -- l_ledger_name  = sales_ledger  (product sales account to CREDIT)
    FETCH cur_digital_bill_items INTO
        l_company_name, l_notes, l_ledger_name,
        l_product_name, l_qty, l_price, l_amt, l_tran_date, l_tran_date1;

    IF exit_loop THEN
        CLOSE cur_digital_bill_items;
        LEAVE digital_bill_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Digital Sales', l_company_name, l_ledger_name, l_amt,
            CONCAT('Digital - ', l_notes, ' - ', l_product_name,
                   ' ', l_qty, 'L @ ', l_price), l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«bill_no»',
            CONCAT('DIG-', DATE_FORMAT(STR_TO_DATE(l_tran_date1,'%Y%m%d'),'%d%m%y')));
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_notes);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product»',      l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«price»',        l_price);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',          l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«salesledger»',  l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP digital_bill_loop;

INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'After digital bill items (day bill)');

-- ══════════════════════════════════════════════════════════════════════════
-- 7. CUSTOMER RECEIPTS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_receipts;

receipts_loop: LOOP
    FETCH cur_receipts INTO
        l_bill_no, l_company_name, l_amt, l_notes, l_tran_date1;

    IF exit_loop THEN
        CLOSE cur_receipts;
        LEAVE receipts_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Cash Receipts', l_company_name, 'Cash', l_amt, l_notes, l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment_receipt;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_notes);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP receipts_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. CASHFLOW EXPENSES / INCOME
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_cashflow;

cashflow_loop: LOOP
    FETCH cur_cashflow INTO
        l_amt, l_tran_date1, l_narration, l_exp, l_ledger_name;

    IF exit_loop THEN
        CLOSE cur_cashflow;
        LEAVE cashflow_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            CASE WHEN l_exp = 'Y' THEN 'Cash Expenses' ELSE 'Cash Income' END,
            CASE WHEN l_exp = 'Y' THEN 'Cash' ELSE l_ledger_name END,
            CASE WHEN l_exp = 'Y' THEN l_ledger_name ELSE 'Cash' END,
            l_amt, l_narration, l_seq
        );
    ELSE
        SET xml_data_segment_temp =
            IF(l_exp = 'Y', xml_data_segment_cashflow_exp, xml_data_segment_cashflow_receipt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_narration);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_ledger_name);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP cashflow_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. BANK DEBIT TRANSACTIONS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_bank_debit_transactionv2;

bankv2_debit_loop: LOOP
    FETCH cur_bank_debit_transactionv2 INTO
        l_bank_trans_date, l_amt, l_ledger_name, l_trans_ledger_name, l_narration;

    IF exit_loop THEN
        CLOSE cur_bank_debit_transactionv2;
        LEAVE bankv2_debit_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_bank_trans_date, '%Y%m%d'),
            'Bank Transactions', l_ledger_name, l_trans_ledger_name, l_amt, l_narration, l_seq
        );
    ELSE
        IF l_ledger_name = 'INDIANOIL CORPORATION LIMITED' THEN
            SET xml_data_segment_temp = xml_data_segment_journal;
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledgerfrom»', l_trans_ledger_name);
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',     l_ledger_name);
        ELSE
            SET xml_data_segment_temp = xml_data_segment_debitbankV2;
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',     l_ledger_name);
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledgerfrom»', l_trans_ledger_name);
        END IF;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_bank_trans_date);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_narration);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP bankv2_debit_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 10. BANK CREDIT TRANSACTIONS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
OPEN cur_bank_credit_transactionv2;

bankv2_credit_loop: LOOP
    FETCH cur_bank_credit_transactionv2 INTO
        l_bank_trans_date, l_amt, l_ledger_name, l_trans_ledger_name, l_narration;

    IF exit_loop THEN
        CLOSE cur_bank_credit_transactionv2;
        LEAVE bankv2_credit_loop;
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_bank_trans_date, '%Y%m%d'),
            'Bank Transactions', l_trans_ledger_name, l_ledger_name, l_amt, l_narration, l_seq
        );
    ELSE
        IF l_ledger_name = 'INDIANOIL CORPORATION LIMITED' THEN
            SET xml_data_segment_temp = xml_data_segment_journal;
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',     l_trans_ledger_name);
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledgerfrom»', l_ledger_name);
        ELSE
            SET xml_data_segment_temp = xml_data_segment_creditbankV2;
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledgerfrom»', l_trans_ledger_name);
            SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',     l_ledger_name);
        END IF;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_bank_trans_date);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',        l_narration);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP bankv2_credit_loop;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. IOCL STOCK RECEIPTS (fuel purchases)
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before IOCL purchase');

OPEN cur_iocl_purchase;

iocl_loop: LOOP
    FETCH cur_iocl_purchase INTO
        l_ledger_name, l_qty, l_amt, l_product_name, l_invoice_num, l_tran_date1;

    IF exit_loop THEN
        CLOSE cur_iocl_purchase;
        LEAVE iocl_loop;
    END IF;

    SET l_tcs_amt           = l_amt / (100.1 * 10);
    SET l_tcs_dedecuted_amt = l_amt - l_tcs_amt;
    SET l_iocl_rate         = l_tcs_dedecuted_amt / l_qty;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Purchase', 'INDIANOIL CORPORATION LIMITED', l_ledger_name, l_amt,
            CONCAT(l_product_name, '-', l_qty, '-', l_invoice_num), l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment_iocl_pur;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',       l_ledger_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«product_name»', l_product_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«qty»',          l_qty);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',       l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«rate»',         l_iocl_rate);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«invoice_num»',  l_invoice_num);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP iocl_loop;

INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'After IOCL purchase');

-- ══════════════════════════════════════════════════════════════════════════
-- 12. ADJUSTMENTS
-- ══════════════════════════════════════════════════════════════════════════
SET exit_loop = FALSE;
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'Before adjustments');

OPEN cur_adjustments;

adjustments_loop: LOOP
    FETCH cur_adjustments INTO
        l_bill_no, l_company_name, l_contra_ledger,
        l_debit_amount, l_credit_amount, l_tran_date, l_tran_date1, l_notes;

    IF exit_loop THEN
        CLOSE cur_adjustments;
        LEAVE adjustments_loop;
    END IF;

    IF l_debit_amount > 0 THEN
        SET l_amt         = l_debit_amount;
        SET l_ledger_name = l_contra_ledger;   -- CREDIT side
        -- l_company_name stays as DEBIT side
    ELSE
        SET l_amt         = l_credit_amount;
        SET l_ledger_name = l_company_name;    -- CREDIT side
        SET l_company_name = l_contra_ledger;  -- DEBIT side
    END IF;

    IF p_mode = 'REPORT' THEN
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_tally_daybook_report (
            temp_table_id, location_code, txn_date, voucher_type,
            ledger_from, ledger_to, amount, narration, sequence_no
        ) VALUES (
            l_temp_table_id, p_location_code, STR_TO_DATE(l_tran_date1, '%Y%m%d'),
            'Adjustments', l_ledger_name, l_company_name, l_amt, l_notes, l_seq
        );
    ELSE
        SET xml_data_segment_temp = xml_data_segment_journal;
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledgerfrom»', l_company_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«ledger»',     l_ledger_name);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«amount»',     l_amt);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«dateformatted»', l_tran_date1);
        SET xml_data_segment_temp = REPLACE(xml_data_segment_temp, '«notes»',      l_notes);
        SET l_seq = l_seq + 1;
        INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
        VALUES (l_temp_table_id, p_location_code, xml_data_segment_temp, l_seq);
    END IF;
END LOOP adjustments_loop;

INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'After adjustments');

-- ═════════════════════════════════════════════════════════════════════════
-- FINALISE
-- ═════════════════════════════════════════════════════════════════════════

IF p_mode = 'REPORT' THEN
    RETURN 'REPORT_DONE';
END IF;

SET l_seq = l_seq + 1;
INSERT INTO t_temp_xml_table (id, location_code, xml_data, sequence_no)
VALUES (l_temp_table_id, p_location_code, xml_template_data_end, l_seq);

SELECT GROUP_CONCAT(
    REPLACE(xml_data, '&', '&amp;')
    ORDER BY sequence_no SEPARATOR ''
) INTO l_tally_output
FROM t_temp_xml_table;

INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, LENGTH(l_tally_output));
INSERT INTO t_tallyexport_log (location_code, export_date, log_messsage)
VALUES (p_location_code, p_closing_date, 'End tally_export_v2');

RETURN l_tally_output;

END ;;

DELIMITER ;

SELECT 'tally_export_v2 created successfully' AS status;
