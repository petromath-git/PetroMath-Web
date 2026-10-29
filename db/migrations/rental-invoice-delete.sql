-- ============================================================================
-- Rental invoices: delete a final / cancelled invoice — tkt #35
--
-- t_rental_invoice_deleted keeps every deleted invoice: the main figures as
-- columns (for the Deleted tab) and the whole t_rental_invoice row as JSON in
-- invoice_data, so nothing is lost even if columns are added to the invoice
-- table later. number_reused = Y when it was the latest number and the running
-- number was stepped back so the next invoice takes it again.
--
-- Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_rental_invoice_deleted (
    deleted_id          INT           NOT NULL AUTO_INCREMENT,
    invoice_id          INT           NOT NULL COMMENT 't_rental_invoice.invoice_id it had',
    location_code       VARCHAR(50)   NOT NULL,
    tenant_id           INT           NOT NULL,
    invoice_no          INT           NULL,
    invoice_date        DATE          NOT NULL,
    period_month        DATE          NOT NULL,
    tenant_name         VARCHAR(200)  NULL,
    tenant_gstin        VARCHAR(15)   NULL,
    taxable_value       DECIMAL(12,2) NOT NULL,
    cgst_amount         DECIMAL(12,2) NOT NULL,
    sgst_amount         DECIMAL(12,2) NOT NULL,
    total_amount        DECIMAL(12,2) NOT NULL,
    tds_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status_at_delete    VARCHAR(20)   NOT NULL,
    delete_reason       VARCHAR(300)  NOT NULL,
    number_reused       CHAR(1)       NOT NULL DEFAULT 'N',
    invoice_data        JSON          NOT NULL,
    deleted_by          VARCHAR(45)   NULL,
    deleted_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (deleted_id),
    KEY idx_rental_inv_deleted_loc (location_code, deleted_date),
    KEY idx_rental_inv_deleted_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
