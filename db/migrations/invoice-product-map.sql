-- Migration: Add product_id to invoice lines + product mapping table
-- Run on dev DB. Truncates existing test invoice data first.

TRUNCATE TABLE t_tank_invoice_charges;
TRUNCATE TABLE t_tank_invoice_dtl;
TRUNCATE TABLE t_tank_invoice;

ALTER TABLE t_tank_invoice_dtl
    ADD COLUMN product_id INT NOT NULL AFTER invoice_id;

CREATE TABLE IF NOT EXISTS t_invoice_product_map (
    id                   INT NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(20) NOT NULL,
    supplier             VARCHAR(10) NOT NULL,
    invoice_product_name VARCHAR(100) NOT NULL,
    product_id           INT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inv_prod_map (location_code, supplier, invoice_product_name)
);
