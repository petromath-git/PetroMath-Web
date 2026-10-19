const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');
const moment = require('moment');

// Digital Recon match groups: every row of a group carries the same recon_match_id
// across these tables. Bank Deposit Recon uses recon_match_id on t_bank_transaction /
// t_cashflow_transaction in its own id space - never touched here.
const MATCH_TABLES = {
    t_digital_sales: 'digital_sales_id',
    t_bowser_digital_sales: 'digital_id',
    t_receipts: 'treceipt_id',
    t_adjustments: 'adjustment_id'
};

const DATE_FIELDS = ['transaction_date', 'receipt_date', 'adjustment_date'];
const AMOUNT_FIELDS = ['amount', 'debit_amount', 'credit_amount'];

function fieldChanged(field, oldVal, newVal) {
    if (newVal === undefined) return false; // field not being written
    const oldEmpty = oldVal === null || oldVal === undefined || oldVal === '';
    const newEmpty = newVal === null || newVal === '';
    if (oldEmpty || newEmpty) return oldEmpty !== newEmpty;
    if (AMOUNT_FIELDS.includes(field)) return Math.abs(Number(oldVal) - Number(newVal)) > 0.001;
    if (DATE_FIELDS.includes(field)) return moment(oldVal).format('YYYY-MM-DD') !== moment(newVal).format('YYYY-MM-DD');
    return String(oldVal) !== String(newVal);
}

const self = module.exports = {

    // Unmatch whole groups: when one row of a group is deleted or changed, the rest
    // must not stay marked reconciled against a partner that is gone or different.
    // Also drops the saved difference of each group. Returns rows unmatched.
    clearMatchGroups: async (matchIds, transaction = null) => {
        const ids = [...new Set((matchIds || []).filter(id => id !== null && id !== undefined && id !== ''))].map(String);
        if (ids.length === 0) return 0;

        let affected = 0;
        for (const table of Object.keys(MATCH_TABLES)) {
            const [, meta] = await db.sequelize.query(
                `UPDATE ${table}
                    SET recon_match_id = NULL, manual_recon_flag = 0,
                        manual_recon_by = NULL, manual_recon_date = NULL
                  WHERE recon_match_id IN (:ids)`,
                { replacements: { ids }, transaction }
            );
            affected += (meta && meta.affectedRows) || 0;
        }
        await db.sequelize.query(
            `DELETE FROM t_digital_recon_differences WHERE match_id IN (:ids)`,
            { replacements: { ids }, type: QueryTypes.DELETE, transaction }
        );
        return affected;
    },

    // Match ids held by the given rows of one table
    getMatchIds: async (table, rowIds, transaction = null) => {
        const idCol = MATCH_TABLES[table];
        const ids = (Array.isArray(rowIds) ? rowIds : [rowIds]).filter(id => id !== null && id !== undefined && id !== '');
        if (!idCol || ids.length === 0) return [];
        const rows = await db.sequelize.query(
            `SELECT DISTINCT recon_match_id FROM ${table}
              WHERE ${idCol} IN (:ids) AND recon_match_id IS NOT NULL`,
            { replacements: { ids }, type: QueryTypes.SELECT, transaction }
        );
        return rows.map(r => r.recon_match_id);
    },

    // Call before deleting rows of a match table
    clearForRows: async (table, rowIds, transaction = null) => {
        const matchIds = await self.getMatchIds(table, rowIds, transaction);
        return self.clearMatchGroups(matchIds, transaction);
    },

    // Call before deleting the auto-receipts of a bank transaction (all of them, or
    // only the split-created ones)
    clearForBankTxnReceipts: async (tBankId, transaction = null, { splitsOnly = false } = {}) => {
        const rows = await db.sequelize.query(
            splitsOnly
                ? `SELECT treceipt_id FROM t_receipts
                    WHERE source_split_id IN (SELECT split_id FROM t_bank_transaction_splits WHERE t_bank_id = :tBankId)`
                : `SELECT treceipt_id FROM t_receipts WHERE source_txn_id = :tBankId`,
            { replacements: { tBankId }, type: QueryTypes.SELECT, transaction }
        );
        return self.clearForRows('t_receipts', rows.map(r => r.treceipt_id), transaction);
    },

    // Call before deleting a bowser closing's digital sales
    clearForBowserClosing: async (bowserClosingId, transaction = null) => {
        const rows = await db.sequelize.query(
            `SELECT digital_id FROM t_bowser_digital_sales WHERE bowser_closing_id = :bowserClosingId`,
            { replacements: { bowserClosingId }, type: QueryTypes.SELECT, transaction }
        );
        return self.clearForRows('t_bowser_digital_sales', rows.map(r => r.digital_id), transaction);
    },

    // Call before updating rows of a match table: unmatches the group of any matched
    // row whose recon-relevant fields (amount, party, date) are about to change.
    // rows: [{ <idCol>: id, field: newValue, ... }]
    clearForChangedRows: async (table, rows, fields, transaction = null) => {
        const idCol = MATCH_TABLES[table];
        const updates = (rows || []).filter(r => r && r[idCol]);
        if (!idCol || updates.length === 0) return 0;

        const existing = await db.sequelize.query(
            `SELECT ${idCol} AS id, recon_match_id, ${fields.join(', ')} FROM ${table}
              WHERE ${idCol} IN (:ids) AND recon_match_id IS NOT NULL`,
            { replacements: { ids: updates.map(r => r[idCol]) }, type: QueryTypes.SELECT, transaction }
        );
        if (existing.length === 0) return 0;

        const byId = new Map(updates.map(r => [String(r[idCol]), r]));
        const matchIds = existing
            .filter(old => {
                const upd = byId.get(String(old.id));
                return upd && fields.some(f => fieldChanged(f, old[f], upd[f]));
            })
            .map(old => old.recon_match_id);
        return self.clearMatchGroups(matchIds, transaction);
    },

    // True if the match group has at least one row at this location
    matchBelongsToLocation: async (matchId, locationCode) => {
        const [row] = await db.sequelize.query(
            `SELECT 1 AS ok FROM t_digital_sales tds
               JOIN t_closing tc ON tc.closing_id = tds.closing_id
              WHERE tds.recon_match_id = :matchId AND tc.location_code = :locationCode
             UNION ALL
             SELECT 1 FROM t_bowser_digital_sales bds
               JOIN t_bowser_closing bcl ON bcl.bowser_closing_id = bds.bowser_closing_id
              WHERE bds.recon_match_id = :matchId AND bcl.location_code = :locationCode
             UNION ALL
             SELECT 1 FROM t_receipts WHERE recon_match_id = :matchId AND location_code = :locationCode
             UNION ALL
             SELECT 1 FROM t_adjustments WHERE recon_match_id = :matchId AND location_code = :locationCode
             LIMIT 1`,
            { replacements: { matchId: String(matchId), locationCode }, type: QueryTypes.SELECT }
        );
        return !!row;
    }
};
