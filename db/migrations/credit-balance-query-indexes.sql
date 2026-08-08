-- Migration: Add creditlist_id-based indexes for credit balance queries
--
-- get_closing_credit_balance() / get_opening_credit_balance() (and every report that
-- calls them -- DSR day-close, Credit Summary Report, customer statements, digital
-- reconciliation) filter t_credits/t_receipts/t_adjustments by creditlist_id and a
-- date range. None of these three tables had an index on creditlist_id, so MySQL was
-- forced into a plan driven by a full scan of t_closing (tens of thousands of rows)
-- instead of an indexed lookup on the customer's own transactions.
--
-- Confirmed on beta: adding this index to t_credits alone dropped a 33-customer
-- balance batch from ~5.6s to ~0.76s (~7.5x), with the query plan flipping from a
-- t_closing-driven scan to an indexed t_credits lookup. Purely additive -- does not
-- change any computed value.

ALTER TABLE t_credits
    ADD KEY idx_credits_creditlist_billdate (creditlist_id, credit_bill_date);

ALTER TABLE t_receipts
    ADD KEY idx_receipts_creditlist_date (creditlist_id, receipt_date),
    ADD KEY idx_receipts_digital_creditlist_date (digital_creditlist_id, receipt_date);

ALTER TABLE t_adjustments
    ADD KEY idx_adjustments_external (external_source, external_id, adjustment_date);
