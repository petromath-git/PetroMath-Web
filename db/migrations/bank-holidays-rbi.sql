-- Bank holidays filled automatically from RBI's published list
-- (https://www.rbi.org.in/Scripts/HolidayMatrixDisplay.aspx), per RBI regional office.
-- Banks follow their state's list under the Negotiable Instruments Act, so each
-- location is mapped to the RBI office for its state: from the GST number, else
-- from its bank accounts' IFSC branch state, else picked by hand.
-- See services/bank-holiday-service.js. Safe to re-run.

-- Holidays per RBI office (replaced on every successful fetch of that office + year)
CREATE TABLE IF NOT EXISTS m_bank_holiday_rbi (
    rbi_office      VARCHAR(50)   NOT NULL,
    holiday_date    DATE          NOT NULL,
    description     VARCHAR(300)  NOT NULL,
    holiday_type    VARCHAR(60)   DEFAULT NULL COMMENT 'e.g. Holiday under Negotiable Instruments Act',
    fetched_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rbi_office, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Last fetch per office + year
CREATE TABLE IF NOT EXISTS m_bank_holiday_rbi_fetch (
    rbi_office      VARCHAR(50)   NOT NULL,
    holiday_year    INT           NOT NULL,
    status          VARCHAR(10)   NOT NULL COMMENT 'OK, EMPTY, FAILED',
    row_count       INT           NOT NULL DEFAULT 0,
    error           VARCHAR(500)  DEFAULT NULL,
    fetched_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (rbi_office, holiday_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which RBI office's list a location follows
CREATE TABLE IF NOT EXISTS m_bank_holiday_region (
    location_code   VARCHAR(45)   NOT NULL,
    state_name      VARCHAR(60)   DEFAULT NULL,
    rbi_office      VARCHAR(50)   DEFAULT NULL COMMENT 'NULL = could not be worked out; pick by hand',
    source          VARCHAR(10)   NOT NULL COMMENT 'GST, ADDRESS, IFSC, MANUAL, NONE',
    detail          VARCHAR(200)  DEFAULT NULL COMMENT 'e.g. the GSTIN prefix or IFSC codes used',
    updated_by      VARCHAR(45)   DEFAULT NULL,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (location_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A hand-entered row with hidden_flag = Y removes an automatic holiday on that
-- date (e.g. a local holiday the branch does not observe).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'm_bank_holiday' AND COLUMN_NAME = 'hidden_flag');
SET @s := IF(@c = 0,
    "ALTER TABLE m_bank_holiday ADD COLUMN hidden_flag CHAR(1) NOT NULL DEFAULT 'N' COMMENT 'Y = hides the RBI / 2nd-4th Saturday holiday on this date for this location' AFTER description",
    'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
