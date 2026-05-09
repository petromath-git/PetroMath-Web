ALTER TABLE t_tank_invoice_dtl
    ADD COLUMN qty_unit VARCHAR(5) NOT NULL DEFAULT 'KL' AFTER quantity;
