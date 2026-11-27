-- tkt #499: a freight bill has one row per product per trip, so trips = distinct product
-- invoices (delivery_invoice_no), not the number of rows. Recompute the stored count for
-- bills already uploaded. A row without the number counts as a trip of its own.
-- Safe to re-run.
UPDATE t_tt_invoice i
JOIN (
    SELECT l.invoice_id,
           COUNT(DISTINCT COALESCE(NULLIF(TRIM(l.delivery_invoice_no), ''), CONCAT('#', l.line_id))) AS trips
    FROM t_tt_invoice_line l
    GROUP BY l.invoice_id
) t ON t.invoice_id = i.invoice_id
SET i.trip_count = t.trips
WHERE i.trip_count <> t.trips;
