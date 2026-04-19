-- Migration: Fuel Purchase Invoice tables
-- PDF stored in t_document_store (entity_type='TANK_INVOICE'), not here.
-- Charges stored vertically to accommodate future tax regime changes (GST etc.)

CREATE TABLE IF NOT EXISTS t_tank_invoice (
    id                   INT NOT NULL AUTO_INCREMENT,
    location_id          VARCHAR(20) NOT NULL,
    supplier_id          INT NOT NULL,
    supplier             VARCHAR(10) NULL,
    invoice_number       VARCHAR(50) NULL,
    invoice_date         DATE NULL,
    truck_number         VARCHAR(20) NULL,
    delivery_doc_no      VARCHAR(50) NULL,
    seal_lock_no         VARCHAR(100) NULL,
    total_invoice_amount DECIMAL(12,2) NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS t_tank_invoice_dtl (
    id                INT NOT NULL AUTO_INCREMENT,
    invoice_id        INT NOT NULL,
    product_id        INT NOT NULL,
    product_name      VARCHAR(100) NULL,
    quantity          DECIMAL(8,3) NULL,
    rate_per_kl       DECIMAL(10,3) NULL,
    density           DECIMAL(6,3) NULL,
    hsn_code          VARCHAR(20) NULL,
    total_line_amount DECIMAL(12,2) NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_tid_invoice FOREIGN KEY (invoice_id) REFERENCES t_tank_invoice (id)
);

CREATE TABLE IF NOT EXISTS t_tank_invoice_charges (
    id             INT NOT NULL AUTO_INCREMENT,
    invoice_dtl_id INT NOT NULL,
    charge_type    VARCHAR(50) NOT NULL,
    charge_pct     DECIMAL(5,2) NULL,
    charge_amount  DECIMAL(12,2) NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_tic_dtl FOREIGN KEY (invoice_dtl_id) REFERENCES t_tank_invoice_dtl (id)
);

CREATE TABLE IF NOT EXISTS t_invoice_product_map (
    id                   INT NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(20) NOT NULL,
    supplier_id          INT NOT NULL,
    invoice_product_name VARCHAR(100) NOT NULL,
    product_id           INT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inv_prod_map (location_code, supplier_id, invoice_product_name)
);

-- Data quality fix: t_tank_stk_rcpt_dtl.quantity must support fractional KL
SET @dbname = DATABASE();
SET @sql = IF(
    (SELECT DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @dbname
       AND TABLE_NAME   = 't_tank_stk_rcpt_dtl'
       AND COLUMN_NAME  = 'quantity') = 'int',
    'ALTER TABLE t_tank_stk_rcpt_dtl MODIFY COLUMN quantity DECIMAL(8,3) NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
