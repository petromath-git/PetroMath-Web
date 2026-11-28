-- tkt #481 follow-up: CNG invoices IOCL cancelled.
-- IOCL sends no cancellation PDF or mail; the only trace is a "CANCELLATION OF INVOICE" credit on the
-- bunk's IOCL SAP statement (t_bank_transaction), which does not name the invoice. Staff pair each credit
-- with the CNG purchase invoice of the same amount. The invoice then leaves t_tank_invoice (so every
-- purchase / VAT / GST / stock / GL report drops it with no change) and is kept here, with its PDF
-- (t_document_store entity_type 'CNG_INVOICE_CANCEL'), so it can be put back and is never re-imported.

CREATE TABLE IF NOT EXISTS t_cng_invoice_cancel (
    cancel_id            INT NOT NULL AUTO_INCREMENT,
    location_code        VARCHAR(20)   NOT NULL,
    invoice_number       VARCHAR(50)   NOT NULL,
    invoice_date         DATE          NULL,
    quantity             DECIMAL(10,3) NULL,
    invoice_amount       DECIMAL(12,2) NULL,
    bank_txn_id          INT           NULL COMMENT 't_bank_transaction.t_bank_id of the SAP cancellation credit',
    cancel_doc_no        VARCHAR(30)   NULL COMMENT 'IOCL cancellation document number (0025...)',
    cancel_date          DATE          NULL,
    credit_amount        DECIMAL(12,2) NULL,
    invoice_data         JSON          NOT NULL COMMENT 'header + lines + charges, to put the invoice back',
    cancelled_by         VARCHAR(45)   NOT NULL,
    creation_date        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cancel_id),
    UNIQUE KEY uq_cng_cancel_invoice (location_code, invoice_number),
    UNIQUE KEY uq_cng_cancel_credit (bank_txn_id)
);
