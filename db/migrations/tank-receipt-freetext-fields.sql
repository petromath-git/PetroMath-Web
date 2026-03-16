-- Tank Receipt: Add free-text driver_name and helper_name columns
-- Run this in MySQL Workbench before deploying the code changes.

-- Allow driver_id and helper_id to be NULL (for free-text entries not in master)
ALTER TABLE t_tank_stk_rcpt
  MODIFY COLUMN driver_id INT NULL,
  MODIFY COLUMN helper_id INT NULL;

-- Add free-text name columns
ALTER TABLE t_tank_stk_rcpt
  ADD COLUMN driver_name VARCHAR(200) NULL AFTER driver_id,
  ADD COLUMN helper_name VARCHAR(200) NULL AFTER helper_id;

-- Recreate t_tank_receipt_v:
--   1. Adds COALESCE for free-text driver_name/helper_name
--   2. Removes hardcoded MS/HSD/XMS product columns (now queried dynamically by the app)
--
-- NOTE: Run "SHOW CREATE VIEW t_tank_receipt_v;" first to verify the JOIN aliases
-- used in your current view match those below (p1/p2/p3), and adjust if needed.

CREATE OR REPLACE VIEW t_tank_receipt_v AS
SELECT
    tr.ttank_id,
    tr.invoice_number,
    tr.invoice_date,
    DATE_FORMAT(tr.invoice_date, '%d-%b-%Y')  AS fomratted_inv_date,
    tr.decant_date,
    DATE_FORMAT(tr.decant_date,  '%d-%b-%Y')  AS fomratted_decant_date,
    tr.decant_time,
    tr.truck_id,
    (SELECT mtt.truck_number
       FROM m_tank_truck mtt
      WHERE mtt.truck_id = tr.truck_id)        AS truck_number,
    tr.odometer_reading,
    tr.location_code,
    tr.closing_status,
    tr.cashflow_date,
    COALESCE(tr.driver_name,
        (SELECT mp.Person_Name FROM m_persons mp WHERE mp.Person_id = tr.driver_id)
    )                                           AS driver,
    COALESCE(tr.helper_name,
        (SELECT mp.Person_Name FROM m_persons mp WHERE mp.Person_id = tr.helper_id)
    )                                           AS helper,
    (SELECT mp.Person_Name
       FROM m_persons mp
      WHERE mp.Person_id = tr.decant_incharge)  AS decant_incharge,
    COALESCE(
        (SELECT SUM(d.amount)
           FROM t_tank_stk_rcpt_dtl d
          WHERE d.ttank_id = tr.ttank_id), 0
    )                                           AS amount
FROM t_tank_stk_rcpt tr;
