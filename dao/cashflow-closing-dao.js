const db = require("../db/db-connection");
const CashFlowClosing = db.cashflow_closing;
const CashFlowTxn = db.txn_cashflow;
const ClosingTxn = db.txn_closing;
const CashFlowDenoms = db.cashflow_denoms;
const config = require("../config/app-config");
const { Sequelize, Op } = require("sequelize");

module.exports = {
    findCashflow: (locationCode, cashflowId) => {
        return CashFlowClosing.findOne({
            where: {
                cashflow_id: cashflowId,
                location_code: locationCode
            }
        });
    },
    // Location-less lookup, for callers (e.g. PowerUser) who need to discover
    // a cashflow's actual location before checking whether they can access it.
    findCashflowById: (cashflowId) => {
        return CashFlowClosing.findOne({
            where: { cashflow_id: cashflowId }
        });
    },
    findCashflowClosings: (locationCode, fromDate, toDate) => {
        return CashFlowClosing.findAll({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), ">=",  fromDate)
                    },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "<=",  toDate)
                    }
                ] },
            order: [Sequelize.literal('cashflow_date')]
        });
    },

    // Inflow/outflow per CLOSED day close, using the same entry_type rule as the
    // Cashflow report (reports-cashflow) so the numbers always agree with it.
    findClosedCashflowTotals: (locationCode, fromDate, toDate) => {
        return db.sequelize.query(
            `SELECT tcc.cashflow_id,
                    COALESCE(SUM(CASE WHEN tct.entry_type = 'CREDIT' THEN tct.amount END), 0) AS inflow,
                    COALESCE(SUM(CASE WHEN tct.entry_type = 'DEBIT'  THEN tct.amount END), 0) AS outflow
             FROM t_cashflow_closing tcc
             LEFT JOIN t_cashflow_transaction tct ON tct.cashflow_id = tcc.cashflow_id
             WHERE tcc.location_code = :locationCode
               AND tcc.closing_status = 'CLOSED'
               AND DATE(tcc.cashflow_date) BETWEEN :fromDate AND :toDate
             GROUP BY tcc.cashflow_id`,
            {
                replacements: { locationCode, fromDate, toDate },
                type: Sequelize.QueryTypes.SELECT
            }
        );
    },

    // Most recent day close (any status) — drives the "next day close" card.
    findLatestCashflowClosing: (locationCode) => {
        return db.sequelize.query(
            `SELECT cashflow_id,
                    DATE_FORMAT(cashflow_date, '%Y-%m-%d') AS cashflow_date,
                    closing_status
             FROM t_cashflow_closing
             WHERE location_code = :locationCode
             ORDER BY cashflow_date DESC, cashflow_id DESC
             LIMIT 1`,
            {
                replacements: { locationCode },
                type: Sequelize.QueryTypes.SELECT
            }
        );
    },

    findLatestCashflowDate: (locationCode) => {
        return db.sequelize.query(
            `SELECT DATE_FORMAT(MAX(cashflow_date), '%Y-%m-%d') as latest_date 
            FROM t_cashflow_closing 
            WHERE location_code = :locationCode`,
            {
                replacements: { locationCode },
                type: Sequelize.QueryTypes.SELECT
            }
        );
    },
    // check if cash flow for a specific date is available
    findCashflowClosingsWithSpecificDate: (locationCode, cashflowDate) => {
        return CashFlowClosing.findAll({
                where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        cashflow_date: Sequelize.where(
                                Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "=",  cashflowDate)
                    }
                    ] }
        });
    },
    // TODO: fix below API, query is getting data, but not sequelize!
    findCashflowClosings_old: (locationCode, fromDate, toDate) => {
        return CashFlowClosing.findAll({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        cashflow_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), ">=",  fromDate)
                    },
                    {
                        cashflow_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "<=",  toDate)
                    }
                ] },
            order: [ ['cashflow_date', 'DESC']],
            include: [
                {
                    model: ClosingTxn,
                    where: {
                        location_code: locationCode,
                    },
                    required: false
                }],
        });
    },
    addNew: (cashflowClosing) => {
        return CashFlowClosing.create(cashflowClosing)
    },
    // Dropdown options + existing entries for one flow direction (Credit/InFlow
    // or Debit/OutFlow) of a cashflow. Options come from Account Heads that
    // have a cashflow-scoped Ledger Rule (applies_to_cashflow='Y') for this
    // direction; existing entries come straight off t_cashflow_transaction.entry_type
    // (set at insert time — see trg_cashflow_txn_account_head_insert).
    findCashflowTxnById: async (location, id, type) => {
        const entryType = type === 'IN' ? 'CREDIT' : 'DEBIT';

        const options = await db.sequelize.query(`
            SELECT DISTINCT ah.account_head_id AS id, ah.account_head_name AS name,
                   ah.requires_digital_vendor_link AS requiresDigitalVendor,
                   ah.requires_credit_customer_link AS requiresCustomer
            FROM m_account_heads ah
            INNER JOIN m_ledger_rules mlr
                ON  mlr.location_code = ah.location_code
                AND mlr.external_id   = ah.account_head_id
                AND mlr.source_type   = 'Static'
                AND mlr.applies_to_cashflow = 'Y'
                AND mlr.allowed_entry_type IN (:entryType, 'BOTH')
            WHERE ah.location_code = :location AND ah.active_flag = 'Y'
            ORDER BY COALESCE(mlr.display_sequence, 999999), ah.account_head_name
        `, { replacements: { location, entryType }, type: Sequelize.QueryTypes.SELECT });

        const transactions = await db.sequelize.query(`
            SELECT tct.transaction_id, tct.description, tct.amount, tct.type, tct.calc_flag AS calcFlag,
                   tct.digital_vendor_id AS digitalVendorId,
                   tr.treceipt_id AS originReceiptId
            FROM t_cashflow_transaction tct
            LEFT JOIN t_receipts tr
                ON  tct.source_table = 't_receipts'
                AND tr.treceipt_id = tct.source_id
                AND tr.origin_cashflow_id = tct.cashflow_id
            LEFT JOIN m_ledger_rules mlr
                ON  mlr.location_code = :location
                AND mlr.external_id   = tct.account_head_id
                AND mlr.source_type   = 'Static'
                AND mlr.applies_to_cashflow = 'Y'
            WHERE tct.cashflow_id = :id AND tct.entry_type = :entryType
            ORDER BY COALESCE(mlr.display_sequence, 999999), tct.type, tct.transaction_id
        `, { replacements: { location, id, entryType }, type: Sequelize.QueryTypes.SELECT });

        return { options, transactions };
    },
    // Which of the given Account Heads require a digital-vendor picker
    // (m_account_heads.requires_digital_vendor_link='Y') — used to reject a
    // save server-side if the cashier's vendor selection got bypassed client-side.
    getAccountHeadsRequiringVendorLink: async (accountHeadIds) => {
        if (!accountHeadIds || accountHeadIds.length === 0) return [];
        const rows = await db.sequelize.query(`
            SELECT account_head_id
            FROM m_account_heads
            WHERE account_head_id IN (:accountHeadIds) AND requires_digital_vendor_link = 'Y'
        `, { replacements: { accountHeadIds }, type: Sequelize.QueryTypes.SELECT });
        return rows.map(r => r.account_head_id);
    },
    // Which of the given Account Heads must carry a credit customer
    // (m_account_heads.requires_credit_customer_link='Y', i.e. "Cash Receipt") -
    // such lines become t_receipts rows, never free-text cashflow lines.
    getAccountHeadsRequiringCustomerLink: async (accountHeadIds) => {
        if (!accountHeadIds || accountHeadIds.length === 0) return [];
        const rows = await db.sequelize.query(`
            SELECT account_head_id
            FROM m_account_heads
            WHERE account_head_id IN (:accountHeadIds) AND requires_credit_customer_link = 'Y'
        `, { replacements: { accountHeadIds }, type: Sequelize.QueryTypes.SELECT });
        return rows.map(r => r.account_head_id);
    },
    // Active, non-digital credit customers of a location, for the Day Close
    // Cash Receipt picker and for validating what it posts.
    findCashReceiptCustomers: (locationCode) => {
        return db.sequelize.query(`
            SELECT creditlist_id, Company_Name
            FROM m_credit_list
            WHERE location_code = :locationCode
              AND type = 'Credit'
              AND COALESCE(card_flag, 'N') <> 'Y'
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE())
            ORDER BY Company_Name
        `, { replacements: { locationCode }, type: Sequelize.QueryTypes.SELECT });
    },
    // Creates Cash credit receipts entered on a DRAFT Day Close, dated on the
    // Day Close and tagged with origin_cashflow_id, then regenerates the Day
    // Close so they show up as its linked "Cash Receipt" lines. A row may
    // replace an old free-text Cash Receipt line (replacesTxnId), which is
    // removed in the same transaction.
    createDayCloseReceipts: async (cashflow, rows, username) => {
        await db.sequelize.transaction(async (t) => {
            for (const row of rows) {
                await db.sequelize.query(`
                    INSERT INTO t_receipts
                        (receipt_no, creditlist_id, receipt_type, amount, notes, receipt_date,
                         location_code, origin_cashflow_id, created_by, updated_by)
                    SELECT 0, :creditlistId, 'Cash', :amount, :notes, tcc.cashflow_date,
                           tcc.location_code, tcc.cashflow_id, :username, :username
                    FROM t_cashflow_closing tcc
                    WHERE tcc.cashflow_id = :cashflowId
                `, {
                    replacements: {
                        creditlistId: row.creditlistId,
                        amount: row.amount,
                        notes: row.notes || null,
                        cashflowId: cashflow.cashflowId,
                        username
                    },
                    transaction: t
                });
                if (row.replacesTxnId) {
                    await db.sequelize.query(`
                        DELETE FROM t_cashflow_transaction
                        WHERE transaction_id = :txnId AND cashflow_id = :cashflowId
                          AND COALESCE(calc_flag, 'N') <> 'Y'
                    `, { replacements: { txnId: row.replacesTxnId, cashflowId: cashflow.cashflowId }, transaction: t });
                }
            }
        });
        await db.sequelize.query('CALL generate_cashflow(:cashflowId)', { replacements: { cashflowId: cashflow.cashflowId } });
    },
    findDayCloseReceipt: (receiptId) => {
        return db.sequelize.query(`
            SELECT treceipt_id, origin_cashflow_id, location_code, recon_match_id, manual_recon_flag
            FROM t_receipts WHERE treceipt_id = :receiptId
        `, { replacements: { receiptId }, type: Sequelize.QueryTypes.SELECT })
            .then(rows => rows[0] || null);
    },
    // Removes a receipt entered from a DRAFT Day Close, then regenerates the
    // Day Close so its linked line disappears too.
    deleteDayCloseReceipt: async (receiptId, cashflowId) => {
        await db.sequelize.query(`
            DELETE FROM t_receipts WHERE treceipt_id = :receiptId AND origin_cashflow_id = :cashflowId
        `, { replacements: { receiptId, cashflowId } });
        await db.sequelize.query('CALL generate_cashflow(:cashflowId)', { replacements: { cashflowId } });
    },
    triggerGenerateCashflow : (cashflowId) => {
        const cashflowTxn = db.sequelize.query('CALL generate_cashflow(' + cashflowId + ');', null, { raw: true });
        return cashflowTxn;
    },
    saveCashflowTxns: (data) => {
        const txns = CashFlowTxn.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["description", "type", "account_head_id", "digital_vendor_id", "amount", "updated_by", "updation_date"]});
        return txns;
    },
    delete: (id) => {
        const txn = CashFlowTxn.destroy({ where: { transaction_id: id } });
        return txn;
    },
    finishClosing: (cashflowId) => {
        const closingTxn = CashFlowClosing.update(
            { status: 'CLOSED' },
            { where: { cashflowId: cashflowId } }
        );
        return closingTxn;
    },
    deleteCashFlow: (cashflowId) => {
        return db.sequelize.query(
            'CALL delete_cashflow(' + cashflowId + ');', null, { raw: true }
        );
    },
    getDenomsByCashFlowId: (cashFlowId) => {
        return CashFlowDenoms.findAll({
            where: {'cashflow_id': cashFlowId}
        });
    },
    saveDenoms: (data) => {
        const denomTxn = CashFlowDenoms.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["denomcount", "updated_by", "updation_date"]});
        return denomTxn;
    },

    NewBunk: (locationCode) => {
        return CashFlowClosing.findAll({
            where: { location_code: locationCode }
        });
    },

    findClosingsByCashflowId: (locationCode, cashflowId) => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    c.closing_id,
                    c.closing_date,
                    c.cashier_id,
                    c.cash,
                    c.notes,
                    c.closing_status,
                    c.cashflow_id,
                    p.Person_Name as cashier_name,
                    get_closing_collection(c.closing_id, c.location_code) as total_collection
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                WHERE c.location_code = ? 
                AND c.cashflow_id = ?
                ORDER BY c.closing_date ASC
            `;
            
            db.sequelize.query(query, {
                replacements: [locationCode, cashflowId],
                type: db.sequelize.QueryTypes.SELECT
            }).then(results => {
                resolve(results);
            }).catch(err => {
                console.error('Error fetching closings by cashflow_id:', err);
                reject(err);
            });
        });
    },

    // Add these methods to module.exports in dao/cashflow-closing-dao.js

// Check if cashflow can be reopened (no future cashflows)
canReopenCashflow: async (cashflowId, locationCode) => {
    const result = await db.sequelize.query(
        `SELECT 
            cf1.cashflow_id,
            cf1.cashflow_date,
            cf1.closing_status,
            (SELECT COUNT(*) 
             FROM t_cashflow_closing cf2 
             WHERE cf2.location_code = cf1.location_code 
             AND cf2.cashflow_date > cf1.cashflow_date
             AND cf2.closing_status = 'CLOSED') as future_cashflows_count
        FROM t_cashflow_closing cf1
        WHERE cf1.cashflow_id = :cashflowId
        AND cf1.location_code = :locationCode
        AND cf1.closing_status = 'CLOSED'`,
        {
            replacements: { cashflowId, locationCode },
            type: Sequelize.QueryTypes.SELECT
        }
    );
    
    if (result.length === 0) {
        return { canReopen: false, reason: 'Cashflow not found or not closed' };
    }
    
    if (result[0].future_cashflows_count > 0) {
        return { canReopen: false, reason: 'Future cashflows exist. Cannot reopen this cashflow.' };
    }
    
    return { canReopen: true };
},

// Reopen cashflow (update status to DRAFT)
reopenCashflow: async (cashflowId, locationCode, userId) => {
    return db.sequelize.transaction(async (t) => {
        const result = await db.sequelize.query(
            `UPDATE t_cashflow_closing
            SET closing_status = 'DRAFT',
                updated_by = :userId,
                updation_date = NOW()
            WHERE cashflow_id = :cashflowId
            AND location_code = :locationCode
            AND closing_status = 'CLOSED'`,
            {
                replacements: { cashflowId, locationCode, userId },
                type: Sequelize.QueryTypes.UPDATE,
                transaction: t
            }
        );

        // The after_cashflow_close trigger stamps t_receipts.cashflow_date on close
        // for every receipt this cashflow claimed (source_table/source_id on
        // t_cashflow_transaction still identifies them, since the next
        // generate_cashflow call - which deletes these calc_flag='Y' rows - hasn't
        // run yet). generate_cashflow's cursor only picks up cashflow_date IS NULL
        // rows, so without this reset, reopening and regenerating permanently loses
        // those credit receipts instead of re-claiming them.
        await db.sequelize.query(
            `UPDATE t_receipts tr
             JOIN t_cashflow_transaction tct
               ON tct.source_table = 't_receipts' AND tct.source_id = tr.treceipt_id
             SET tr.cashflow_date = NULL
             WHERE tct.cashflow_id = :cashflowId`,
            { replacements: { cashflowId }, transaction: t }
        );

        return result[1]; // returns number of rows affected
    });
},
};
