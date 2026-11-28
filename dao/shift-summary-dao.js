// dao/shift-summary-dao.js
// Read-only data for the Cashier Shift Summary PDF (tkt #485).
// Mirrors what the closing screen's Summary tab shows, but read from the saved
// rows of one shift (t_closing.closing_id) instead of the form fields.
const db = require('../db/db-connection');

const SELECT = db.Sequelize.QueryTypes.SELECT;

const q = (sql, closingId) => db.sequelize.query(sql, { replacements: { closingId }, type: SELECT });

module.exports = {

    getShiftSummary: async (closingId) => {
        const [header] = await q(`
            SELECT tc.closing_id, tc.location_code, tc.closing_status, tc.cash, tc.notes,
                   DATE_FORMAT(tc.closing_date, '%d-%b-%Y') AS closing_date_fmt,
                   DATE_FORMAT(tc.closing_date, '%Y-%m-%d') AS closing_date_iso,
                   TIME_FORMAT(tc.close_reading_time, '%h:%i %p') AS close_reading_time_fmt,
                   cashier.Person_Name AS cashier_name,
                   closer.Person_Name  AS closer_name,
                   CALCULATE_EXSHORTAGE(tc.closing_id) AS ex_short
            FROM t_closing tc
            LEFT JOIN m_persons cashier ON cashier.Person_id = tc.cashier_id
            LEFT JOIN m_persons closer  ON closer.Person_id  = tc.closer_id
            WHERE tc.closing_id = :closingId`, closingId);

        if (!header) return null;

        const [readings, oil2t, lubes, credits, digital, receipts, advances,
               expenses, denoms, intercompany] = await Promise.all([
            q(`SELECT mp.pump_code, prod.product_name, tr.price,
                      tr.opening_reading, tr.closing_reading, tr.testing,
                      (tr.closing_reading - tr.opening_reading - tr.testing)            AS sale_qty,
                      (tr.closing_reading - tr.opening_reading - tr.testing) * tr.price AS sale_amount
               FROM t_reading tr
               JOIN m_pump mp         ON mp.pump_id = tr.pump_id
               LEFT JOIN m_product prod ON prod.product_id = mp.product_id
               WHERE tr.closing_id = :closingId
               ORDER BY mp.display_order IS NULL, mp.display_order, mp.pump_code, tr.reading_id`, closingId),

            q(`SELECT prod.product_name, t.price, t.given_qty, t.returned_qty,
                      (t.given_qty - t.returned_qty)           AS sale_qty,
                      (t.given_qty - t.returned_qty) * t.price AS sale_amount
               FROM t_2toil t
               JOIN m_product prod ON prod.product_id = t.product_id
               WHERE t.closing_id = :closingId
                 AND (COALESCE(t.given_qty,0) <> 0 OR COALESCE(t.returned_qty,0) <> 0)
               ORDER BY prod.product_name`, closingId),

            q(`SELECT prod.product_name, cs.bill_no, cs.price, cs.price_discount, cs.qty, cs.amount
               FROM t_cashsales cs
               LEFT JOIN m_product prod ON prod.product_id = cs.product_id
               WHERE cs.closing_id = :closingId
               ORDER BY cs.cashsales_id`, closingId),

            q(`SELECT prod.product_name, c.bill_no, cl.Company_Name AS company_name, c.vehicle_number,
                      c.price, c.price_discount, c.qty, c.amount
               FROM t_credits c
               LEFT JOIN m_product prod   ON prod.product_id = c.product_id
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = c.creditlist_id
               WHERE c.closing_id = :closingId
               ORDER BY c.tcredit_id`, closingId),

            q(`SELECT DATE_FORMAT(d.transaction_date, '%d-%b-%Y') AS txn_date_fmt,
                      cl.Company_Name AS vendor_name, d.amount, d.notes
               FROM t_digital_sales d
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = d.vendor_id
               WHERE d.closing_id = :closingId
               ORDER BY d.digital_sales_id`, closingId),

            q(`SELECT DATE_FORMAT(r.receipt_date, '%d-%b-%Y') AS receipt_date_fmt, r.receipt_type,
                      cl.Company_Name AS party_name, r.amount
               FROM t_receipts r
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = r.creditlist_id
               WHERE r.closing_id = :closingId
               ORDER BY r.treceipt_id`, closingId),

            q(`SELECT DATE_FORMAT(l.txn_date, '%d-%b-%Y') AS txn_date_fmt, l.txn_type,
                      e.name AS employee_name,
                      CASE WHEN l.txn_type = 'ADVANCE_RECOVERY' THEN l.credit_amount ELSE l.debit_amount END AS amount
               FROM t_employee_ledger l
               LEFT JOIN m_employee e ON e.employee_id = l.employee_id
               WHERE l.closing_id = :closingId
               ORDER BY l.ledger_id`, closingId),

            q(`SELECT me.Expense_name AS expense_name, te.amount, te.notes
               FROM t_expense te
               LEFT JOIN m_expense me ON me.Expense_id = te.expense_id
               WHERE te.closing_id = :closingId
                 AND COALESCE(te.amount, 0) <> 0
               ORDER BY te.texpense_id`, closingId),

            // denomination '0' = coins/loose, whose count is the rupee amount
            // (same rule as CALCULATE_EXSHORTAGE / the breakdown popup)
            q(`SELECT denomination, denomcount,
                      IF(denomination = '0', 1, denomination) * denomcount AS amount
               FROM t_denomination
               WHERE closing_id = :closingId AND COALESCE(denomcount, 0) <> 0
               ORDER BY CAST(denomination AS DECIMAL(10,2)) DESC`, closingId),

            q(`SELECT b.bowser_name, p.product_name, i.quantity
               FROM t_closing_intercompany i
               JOIN m_bowser  b ON b.bowser_id  = i.bowser_id
               JOIN m_product p ON p.product_id = i.product_id
               WHERE i.closing_id = :closingId
               ORDER BY b.bowser_name`, closingId)
        ]);

        return { header, readings, oil2t, lubes, credits, digital, receipts, advances,
                 expenses, denoms, intercompany };
    }
};
