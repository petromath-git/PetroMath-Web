-- Migration: create t_credit_statement for statement number sequencing
-- Purpose: each time a credit detail/ledger report is generated with
--          SHOW_STATEMENT_NUMBER=Y, a row is inserted and the auto-increment
--          ID (starting at 1000) becomes the statement number.
-- Run on: all environments (dev, prod)

CREATE TABLE IF NOT EXISTS t_credit_statement (
    statement_id   INT          NOT NULL AUTO_INCREMENT,
    location_code  VARCHAR(10)  NOT NULL,
    creditlist_id  INT,
    from_date      DATE         NOT NULL,
    to_date        DATE         NOT NULL,
    report_type    VARCHAR(20)  NOT NULL,
    generated_by   VARCHAR(100),
    generated_at   DATETIME     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (statement_id)
) AUTO_INCREMENT = 1000;
