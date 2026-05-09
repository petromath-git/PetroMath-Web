ALTER TABLE t_invoice_product_map
    ADD COLUMN conversion_factor DECIMAL(10,4) NULL AFTER product_id;
