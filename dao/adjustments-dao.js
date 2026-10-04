// dao/adjustments-dao.js
const db = require("../db/db-connection");
const Adjustments = db.adjustments;
const Credit = db.credit;
const Bank = db.m_bank;
const Lookup = db.lookup;
const { Sequelize, Op } = require("sequelize");
const locationConfig = require('../utils/location-config');

// adjustment_type of "Opening Balance Entry" (m_lookup ADJUSTMENT_TYPE)
const OPENING_BALANCE_TYPE = '201';
// Roles that may delete/restore adjustments; opening balances need a senior role
const DELETE_ROLES = ['Admin', 'PowerUser', 'SuperUser'];
const OPENING_BALANCE_DELETE_ROLES = ['PowerUser', 'SuperUser'];

// Backtick-quoted, comma-separated column list of t_adjustments, read once
let adjustmentColumns = null;
async function getAdjustmentColumns() {
    if (!adjustmentColumns) {
        const rows = await db.sequelize.query(`
            SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 't_adjustments'
            ORDER BY ordinal_position
        `, { type: Sequelize.QueryTypes.SELECT });
        adjustmentColumns = rows.map(r => '`' + r.name + '`').join(', ');
    }
    return adjustmentColumns;
}

module.exports = {

    DELETE_ROLES,
    OPENING_BALANCE_DELETE_ROLES,

    
    // Save new adjustment entry
    saveAdjustment: async (adjustmentData) => {
        try {
            const result = await Adjustments.create(adjustmentData);
            return result;
        } catch (error) {
            console.error('Error saving adjustment:', error);
            throw error;
        }
    },

    // Get adjustment types from lookup table
    getAdjustmentTypes: async () => {
        try {
            return await Lookup.findAll({
                attributes: ['lookup_id', 'description'],
                where: {
                    lookup_type: 'ADJUSTMENT_TYPE'
                },
                order: [['description', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching adjustment types:', error);
            throw error;
        }
    },

    // Get customers (excluding digital vendors)
    getCustomers: async (locationCode) => {
        try {
            return await Credit.findAll({
                attributes: ['creditlist_id', 'Company_Name', 'ledger_name'],
                where: {
                    location_code: locationCode,
                    [Op.or]: [
                        { card_flag: { [Op.ne]: 'Y' } },
                        { card_flag: { [Op.is]: null } }
                    ]
                },
                order: [['Company_Name', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching customers:', error);
            throw error;
        }
    },

    // Get digital vendors (card_flag = 'Y')
    getDigitalVendors: async (locationCode) => {
        try {
            return await Credit.findAll({
                attributes: ['creditlist_id', 'Company_Name', 'ledger_name'],
                where: {
                    location_code: locationCode,
                    card_flag: 'Y'
                },
                order: [['Company_Name', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching digital vendors:', error);
            throw error;
        }
    },

    // Get suppliers
    getSuppliers: async (locationCode) => {
        try {
            const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            
            return await db.m_supplier.findAll({
                attributes: ['supplier_id', 'supplier_name', 'supplier_short_name'],
                where: {
                    location_code: locationCode,
                    effective_end_date: {
                        [Op.gte]: currentDate
                    }
                },
                order: [['supplier_name', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching suppliers:', error);
            throw error;
        }
    },

    // Get bank accounts
    getBankAccounts: async (locationCode) => {
        try {
            return await Bank.findAll({
                attributes: ['bank_id', 'bank_name', 'account_nickname', 'ledger_name'],
                where: {
                    location_code: locationCode
                },
                order: [['bank_name', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching bank accounts:', error);
            throw error;
        }
    },

    // Get expense categories (from lookup table)
    getExpenseCategories: async () => {
        try {
            return await Lookup.findAll({
                attributes: ['lookup_id', 'description'],
                where: {
                    lookup_type: 'EXPENSE_CATEGORY'
                },
                order: [['description', 'ASC']]
            });
        } catch (error) {
            console.error('Error fetching expense categories:', error);
            throw error;
        }
    },

    // Get adjustments list with filters, including the affected party's name.
    // filters.deleted = true lists the archive (t_adjustments_deleted) instead.
    getAdjustmentsList: async (filters) => {
        try {
            const table = filters.deleted ? 't_adjustments_deleted' : 't_adjustments';
            const conditions = ['a.location_code = :locationCode'];
            const replacements = {
                locationCode: filters.locationCode,
                limit: parseInt(filters.limit, 10) || 200
            };

            if (filters.fromDate && filters.toDate) {
                conditions.push('a.adjustment_date BETWEEN :fromDate AND :toDate');
                replacements.fromDate = filters.fromDate;
                replacements.toDate = filters.toDate;
            }
            if (filters.adjustmentType) {
                conditions.push('a.adjustment_type = :adjustmentType');
                replacements.adjustmentType = filters.adjustmentType;
            }
            if (filters.externalSource) {
                conditions.push('a.external_source = :externalSource');
                replacements.externalSource = filters.externalSource;
            }
            if (filters.search) {
                conditions.push(`(a.reference_no LIKE :search OR a.description LIKE :search
                                  OR cl.Company_Name LIKE :search OR s.supplier_name LIKE :search)`);
                replacements.search = `%${filters.search}%`;
            }

            const deletedCols = filters.deleted ? ', a.deleted_by, a.deleted_date, a.delete_reason' : '';

            return await db.sequelize.query(`
                SELECT a.adjustment_id, a.adjustment_date, a.reference_no, a.description,
                       a.external_id, a.external_source, a.debit_amount, a.credit_amount,
                       a.adjustment_type, a.status, a.created_by, a.creation_date,
                       a.recon_match_id, a.manual_recon_flag, a.source_table
                       ${deletedCols},
                       COALESCE(
                           CASE UPPER(a.external_source)
                               WHEN 'CUSTOMER'       THEN cl.Company_Name
                               WHEN 'DIGITAL_VENDOR' THEN cl.Company_Name
                               WHEN 'SUPPLIER'       THEN s.supplier_name
                               WHEN 'BANK'           THEN COALESCE(b.account_nickname, b.bank_name)
                               WHEN 'EXPENSE'        THEN ex.description
                           END,
                           a.ledger_name
                       ) AS party_name
                FROM ${table} a
                LEFT JOIN m_credit_list cl ON cl.creditlist_id = a.external_id
                     AND UPPER(a.external_source) IN ('CUSTOMER', 'DIGITAL_VENDOR')
                LEFT JOIN m_supplier s ON s.supplier_id = a.external_id
                     AND UPPER(a.external_source) = 'SUPPLIER'
                LEFT JOIN m_bank b ON b.bank_id = a.external_id
                     AND UPPER(a.external_source) = 'BANK'
                LEFT JOIN m_lookup ex ON ex.lookup_id = a.external_id
                     AND ex.lookup_type = 'EXPENSE_CATEGORY'
                     AND UPPER(a.external_source) = 'EXPENSE'
                WHERE ${conditions.join(' AND ')}
                ORDER BY ${filters.deleted ? 'a.deleted_date DESC' : 'a.adjustment_date DESC, a.creation_date DESC'}
                LIMIT :limit
            `, { replacements, type: Sequelize.QueryTypes.SELECT });
        } catch (error) {
            console.error('Error fetching adjustments list:', error);
            throw error;
        }
    },

    // Get adjustment details by ID
    getAdjustmentById: async (adjustmentId) => {
        try {
            return await Adjustments.findByPk(adjustmentId);
        } catch (error) {
            console.error('Error fetching adjustment by ID:', error);
            throw error;
        }
    },

    // Get adjustments summary for dashboard/reports
    getAdjustmentsSummary: async (locationCode, fromDate, toDate) => {
        try {
            const result = await Adjustments.findAll({
                attributes: [
                    'external_source',
                    'adjustment_type',
                    [Sequelize.fn('COUNT', Sequelize.col('adjustment_id')), 'count'],
                    [Sequelize.fn('SUM', Sequelize.col('debit_amount')), 'total_debit'],
                    [Sequelize.fn('SUM', Sequelize.col('credit_amount')), 'total_credit']
                ],
                where: {
                    location_code: locationCode,
                    adjustment_date: {
                        [Op.between]: [fromDate, toDate]
                    },
                    status: 'ACTIVE'
                },
                group: ['external_source', 'adjustment_type'],
                order: [['external_source', 'ASC'], ['adjustment_type', 'ASC']]
            });

            return result;
        } catch (error) {
            console.error('Error fetching adjustments summary:', error);
            throw error;
        }
    },

    // Find the active adjustment auto-created from a specific cashflow transaction
    // (source_table/source_id tie-back — see syncFromCashflowTxn below)
    findActiveByCashflowTxnId: async (transactionId) => {
        try {
            return await Adjustments.findOne({
                where: {
                    source_table: 't_cashflow_transaction',
                    source_id: transactionId,
                    status: 'ACTIVE'
                }
            });
        } catch (error) {
            console.error('Error finding adjustment by cashflow txn id:', error);
            throw error;
        }
    },

    // Delete an auto-created adjustment row (hard delete - these aren't user-entered,
    // so there's no audit value in keeping a REVERSED copy around)
    deleteAdjustment: async (adjustmentId) => {
        try {
            return await Adjustments.destroy({ where: { adjustment_id: adjustmentId } });
        } catch (error) {
            console.error('Error deleting adjustment:', error);
            throw error;
        }
    },

    // Copy a user-entered adjustment to t_adjustments_deleted, then delete it.
    // Columns are copied by name from information_schema so the archive stays a
    // faithful copy (see db/migrations/adjustments-deleted-archive.sql).
    archiveAndDeleteAdjustment: async (adjustmentId, deletedBy, reason) => {
        const cols = await getAdjustmentColumns();
        const t = await db.sequelize.transaction();
        try {
            await db.sequelize.query(`
                INSERT INTO t_adjustments_deleted (${cols}, deleted_by, deleted_date, delete_reason)
                SELECT ${cols}, :deletedBy, NOW(), :reason
                FROM t_adjustments WHERE adjustment_id = :adjustmentId
            `, { replacements: { adjustmentId, deletedBy, reason: reason || null }, transaction: t });

            await db.sequelize.query(
                `DELETE FROM t_adjustments WHERE adjustment_id = :adjustmentId`,
                { replacements: { adjustmentId }, transaction: t }
            );
            await t.commit();
        } catch (error) {
            await t.rollback();
            console.error('Error archiving/deleting adjustment:', error);
            throw error;
        }
    },

    getDeletedAdjustmentById: async (adjustmentId) => {
        const rows = await db.sequelize.query(
            `SELECT * FROM t_adjustments_deleted WHERE adjustment_id = :adjustmentId`,
            { replacements: { adjustmentId }, type: Sequelize.QueryTypes.SELECT }
        );
        return rows[0] || null;
    },

    // Put an archived adjustment back with its original adjustment_id (the GL
    // insert trigger posts it again) and remove it from the archive.
    restoreAdjustment: async (adjustmentId, restoredBy) => {
        const cols = await getAdjustmentColumns();
        const t = await db.sequelize.transaction();
        try {
            await db.sequelize.query(`
                INSERT INTO t_adjustments (${cols})
                SELECT ${cols} FROM t_adjustments_deleted WHERE adjustment_id = :adjustmentId
            `, { replacements: { adjustmentId }, transaction: t });

            await db.sequelize.query(`
                UPDATE t_adjustments SET updated_by = :restoredBy, updation_date = NOW()
                WHERE adjustment_id = :adjustmentId
            `, { replacements: { adjustmentId, restoredBy }, transaction: t });

            await db.sequelize.query(
                `DELETE FROM t_adjustments_deleted WHERE adjustment_id = :adjustmentId`,
                { replacements: { adjustmentId }, transaction: t }
            );
            await t.commit();
        } catch (error) {
            await t.rollback();
            console.error('Error restoring adjustment:', error);
            throw error;
        }
    },

    // Create/update/remove the digital-vendor debit adjustment linked to one
    // cashflow Outflow row (t_cashflow_transaction), keeping it in sync as the
    // cashier edits amount/vendor/removes the row. Throws if the linked
    // adjustment has already been bank-reconciled, so a reconciled entry is
    // never silently changed out from under the reconciliation.
    syncFromCashflowTxn: async ({ transactionId, locationCode, adjustmentDate, digitalVendorId, vendorName, amount, username }) => {
        const existing = await module.exports.findActiveByCashflowTxnId(transactionId);
        const isReconciled = existing && (existing.manual_recon_flag || existing.recon_match_id);
        const wantsAdjustment = digitalVendorId && amount > 0;

        if (isReconciled) {
            throw new Error(`Cannot update: the linked adjustment (#${existing.adjustment_id}) has already been bank-reconciled. Remove the reconciliation first.`);
        }

        if (!wantsAdjustment) {
            if (existing) {
                await module.exports.deleteAdjustment(existing.adjustment_id);
            }
            return null;
        }

        const description = `Auto: Cash paid against ${vendorName} collection (CashFlow Txn #${transactionId})`;

        if (existing) {
            await Adjustments.update({
                external_id: digitalVendorId,
                debit_amount: amount,
                description,
                updated_by: username,
                updation_date: new Date()
            }, { where: { adjustment_id: existing.adjustment_id } });
            return existing.adjustment_id;
        }

        const created = await Adjustments.create({
            adjustment_date: adjustmentDate,
            location_code: locationCode,
            description,
            external_id: digitalVendorId,
            external_source: 'DIGITAL_VENDOR',
            debit_amount: amount,
            adjustment_type: '208',
            status: 'ACTIVE',
            source_table: 't_cashflow_transaction',
            source_id: transactionId,
            created_by: username,
            updated_by: username
        });
        return created.adjustment_id;
    },

    // Check if adjustment can be modified/deleted (business rules)

     canModifyAdjustment: async (adjustmentId, role) => {
        try {
            const adjustment = await Adjustments.findByPk(adjustmentId);
            if (!adjustment) {
                return { canModify: false, reason: 'Adjustment not found' };
            }

            if (!DELETE_ROLES.includes(role)) {
                return { canModify: false, reason: 'You do not have permission to delete adjustments' };
            }

            if (adjustment.adjustment_type === OPENING_BALANCE_TYPE && !OPENING_BALANCE_DELETE_ROLES.includes(role)) {
                return { canModify: false, reason: 'Opening balance entries can only be deleted by a PowerUser or SuperUser' };
            }

            if (adjustment.status !== 'ACTIVE') {
                return { canModify: false, reason: `Adjustment is ${adjustment.status}` };
            }

            // Auto-created rows (e.g. digital-vendor cash payout) are owned by their
            // source screen and must be changed there
            if (adjustment.source_table) {
                return { canModify: false, reason: 'This adjustment was created automatically; change it from its source screen' };
            }

            if (adjustment.recon_match_id || adjustment.manual_recon_flag) {
                return { canModify: false, reason: 'Adjustment is bank-reconciled; remove the reconciliation first' };
            }

            // Get max days from config (global or location-specific)
            const maxDays = Number(await locationConfig.getLocationConfigValue(
                adjustment.location_code,
                'ADJUSTMENT_MODIFY_MAX_DAYS',
                30  // default fallback
            ));

            // SuperUser is exempt so data clean-ups of older entries stay possible
            const daysDiff = Math.floor((new Date() - new Date(adjustment.adjustment_date)) / (1000 * 60 * 60 * 24));
            if (daysDiff > maxDays && role !== 'SuperUser') {
                return { canModify: false, reason: `Cannot modify adjustments older than ${maxDays} days` };
            }

            return { canModify: true, reason: null };
        } catch (error) {
            console.error('Error checking if adjustment can be modified:', error);
            throw error;
        }
    }
};