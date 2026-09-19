-- ============================================================
-- GL Accounting: persistent staging for the Tally master-file import
-- Generated: 2026-09-17
--
-- The Tally Import tool (Ledger Master > Tally Import) used to hold the
-- parsed file and every match/override only in browser memory for the
-- current page load — logging off, refreshing, or just navigating away
-- before clicking "Save All" lost all progress and forced a re-upload.
--
-- gl_tally_import_batch tracks one in-progress (or discarded) upload per
-- location; gl_tally_import_row holds each Tally ledger name from that
-- file and its current resolution, autosaved as the admin works through
-- the reconcile screen. Only one IN_PROGRESS batch is kept per location —
-- uploading a new file while one is unfinished requires an explicit
-- discard (see /gl/tally-import/discard) so a wrong-file upload doesn't
-- silently clobber matching already done. "Save All" (POST
-- /gl/tally-import/save) is still the only thing that writes into
-- gl_ledgers.tally_ledger_name — this staging data is scratch state, not
-- itself part of the ledger master.
-- ============================================================

CREATE TABLE IF NOT EXISTS gl_tally_import_batch (
    batch_id       INT NOT NULL AUTO_INCREMENT,
    location_code  VARCHAR(50)  NOT NULL,
    file_name      VARCHAR(255) NULL,
    status         ENUM('IN_PROGRESS','DISCARDED') NOT NULL DEFAULT 'IN_PROGRESS',
    created_by     VARCHAR(45),
    creation_date  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by     VARCHAR(45),
    updated_date   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id),
    KEY idx_gl_tally_batch_location_status (location_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gl_tally_import_row (
    row_id             INT NOT NULL AUTO_INCREMENT,
    batch_id           INT NOT NULL,
    row_order          INT NOT NULL,
    tally_name         VARCHAR(250) NOT NULL,
    tally_group_name   VARCHAR(250) NULL,
    suggested_group_id INT NULL,
    ledger_id          INT NULL,
    match_status       ENUM('AUTO','MANUAL','CREATED','SKIPPED','UNRESOLVED') NOT NULL DEFAULT 'UNRESOLVED',
    applied_flag       CHAR(1) NOT NULL DEFAULT 'N',
    updated_by         VARCHAR(45),
    updated_date       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (row_id),
    KEY idx_gl_tally_row_batch (batch_id),
    CONSTRAINT fk_gl_tally_row_batch FOREIGN KEY (batch_id) REFERENCES gl_tally_import_batch(batch_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
