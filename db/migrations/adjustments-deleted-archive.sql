-- Migration: archive table for deleted adjustments
--
-- The Adjustments screen deletes rows (the old Reverse action was removed).
-- Before deleting, the row is copied here so a mistaken delete can be
-- restored from the "Show deleted" view.
--
-- Built with CREATE TABLE ... AS SELECT so the column list and order match
-- t_adjustments exactly. The app copies rows by column name (read from
-- information_schema), so a column later added to t_adjustments must also be
-- added here or delete/restore will fail loudly.
--
-- Restoring re-inserts the row with its original adjustment_id; the GL insert
-- trigger on t_adjustments then posts it again.

CREATE TABLE t_adjustments_deleted AS
SELECT * FROM t_adjustments WHERE 1 = 0;

ALTER TABLE t_adjustments_deleted
    ADD COLUMN deleted_by    VARCHAR(45)  NOT NULL,
    ADD COLUMN deleted_date  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN delete_reason VARCHAR(500) NULL,
    ADD PRIMARY KEY (adjustment_id),
    ADD INDEX idx_adj_deleted_loc_date (location_code, deleted_date);

-- Verify: should list t_adjustments' columns + the 3 above
SELECT column_name
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 't_adjustments_deleted'
ORDER BY ordinal_position;
