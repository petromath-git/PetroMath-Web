DROP FUNCTION IF EXISTS get_closing_credit_balance;

CREATE DEFINER=`petromath_prod`@`%` FUNCTION `get_closing_credit_balance`(
    p_creditlist_id INT,
    p_closing_bal_date DATE
) RETURNS decimal(10,2)
BEGIN
    DECLARE l_opening_balance, l_total_bills, l_total_receipts, l_total_adjustments DECIMAL(10,2);
    DECLARE l_total_digital_sales, l_total_customer_payments_via_digital DECIMAL(10,2);
    DECLARE l_total_bowser_bills DECIMAL(10,2);
    DECLARE l_total_bowser_digital_sales DECIMAL(10,2);
    DECLARE l_opening_balance_date DATE;
    DECLARE l_balance DECIMAL(10,2);
    DECLARE l_count INT;
    DECLARE l_is_digital_vendor CHAR(1);

    SELECT card_flag INTO l_is_digital_vendor
    FROM m_credit_list
    WHERE creditlist_id = p_creditlist_id;

    SELECT balance, balance_date
    INTO l_opening_balance, l_opening_balance_date
    FROM r_credit_open_bal
    WHERE creditlist_id = p_creditlist_id
      AND balance_date = (
          SELECT MAX(balance_date)
          FROM r_credit_open_bal
          WHERE balance_date <= p_closing_bal_date
            AND creditlist_id = p_creditlist_id
      );

    IF l_is_digital_vendor = 'Y' THEN
        SELECT COALESCE(SUM(tds.amount), 0)
        INTO l_total_digital_sales
        FROM t_digital_sales tds
        INNER JOIN t_closing tc ON tds.closing_id = tc.closing_id
        WHERE tds.vendor_id = p_creditlist_id
          AND DATE(tc.closing_date) <= p_closing_bal_date
          AND DATE(tc.closing_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(bds.amount), 0)
        INTO l_total_bowser_digital_sales
        FROM t_bowser_digital_sales bds
        JOIN t_bowser_closing bcl ON bcl.bowser_closing_id = bds.bowser_closing_id
        WHERE bds.digital_vendor_id = p_creditlist_id
          AND bcl.status = 'CLOSED'
          AND DATE(bcl.closing_date) <= p_closing_bal_date
          AND DATE(bcl.closing_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(tr.amount), 0)
        INTO l_total_customer_payments_via_digital
        FROM t_receipts tr
        WHERE tr.digital_creditlist_id = p_creditlist_id
          AND DATE(tr.receipt_date) <= p_closing_bal_date
          AND DATE(tr.receipt_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(tr.amount), 0)
        INTO l_total_receipts
        FROM t_receipts tr
        WHERE tr.creditlist_id = p_creditlist_id
          AND DATE(tr.receipt_date) <= p_closing_bal_date
          AND DATE(tr.receipt_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(ta.debit_amount), 0) - COALESCE(SUM(ta.credit_amount), 0)
        INTO l_total_adjustments
        FROM t_adjustments ta
        WHERE ta.external_source = 'DIGITAL_VENDOR'
          AND ta.external_id = p_creditlist_id
          AND ta.status = 'ACTIVE'
          AND DATE(ta.adjustment_date) <= p_closing_bal_date
          AND DATE(ta.adjustment_date) >= l_opening_balance_date;

        SET l_balance = l_opening_balance
                        + COALESCE(l_total_digital_sales, 0)
                        + COALESCE(l_total_bowser_digital_sales, 0)
                        + COALESCE(l_total_customer_payments_via_digital, 0)
                        - COALESCE(l_total_receipts, 0)
                        + COALESCE(l_total_adjustments, 0);

    ELSE
        SELECT SUM(COALESCE(tc.amount, 0)), COUNT(tc.amount)
        INTO l_total_bills, l_count
        FROM t_credits tc
        JOIN t_closing tcc ON tc.closing_id = tcc.closing_id
        WHERE tc.creditlist_id = p_creditlist_id
          AND COALESCE(tc.credit_bill_date, DATE(tcc.closing_date)) <= p_closing_bal_date
          AND COALESCE(tc.credit_bill_date, DATE(tcc.closing_date)) >= l_opening_balance_date;

        SELECT COALESCE(SUM(bc.amount), 0)
        INTO l_total_bowser_bills
        FROM t_bowser_credits bc
        JOIN t_bowser_closing bcl ON bcl.bowser_closing_id = bc.bowser_closing_id
        WHERE bc.creditlist_id = p_creditlist_id
          AND bcl.status = 'CLOSED'
          AND DATE(bcl.closing_date) <= p_closing_bal_date
          AND DATE(bcl.closing_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(tr.amount), 0)
        INTO l_total_receipts
        FROM t_receipts tr
        WHERE tr.creditlist_id = p_creditlist_id
          AND DATE(tr.receipt_date) <= p_closing_bal_date
          AND DATE(tr.receipt_date) >= l_opening_balance_date;

        SELECT COALESCE(SUM(ta.debit_amount), 0) - COALESCE(SUM(ta.credit_amount), 0)
        INTO l_total_adjustments
        FROM t_adjustments ta
        WHERE ta.external_source = 'CUSTOMER'
          AND ta.external_id = p_creditlist_id
          AND ta.status = 'ACTIVE'
          AND DATE(ta.adjustment_date) <= p_closing_bal_date
          AND DATE(ta.adjustment_date) >= l_opening_balance_date;

        SET l_balance = l_opening_balance
                        + COALESCE(l_total_bills, 0)
                        + COALESCE(l_total_bowser_bills, 0)
                        - COALESCE(l_total_receipts, 0)
                        + COALESCE(l_total_adjustments, 0);
    END IF;

    RETURN l_balance;
END;
