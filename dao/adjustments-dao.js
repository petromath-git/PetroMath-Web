// dao/adjustments-dao.js
const db = require("../db/db-connection");
const Adjustments = db.adjustments;
const Credit = db.credit;
const Bank = db.m_bank;
const Lookup = db.lookup;
const { Sequelize, Op } = require("sequelize");
const locationConfig = require('../utils/location-config');

module.exports = {
    
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

    // Get adjustments list with filters
    getAdjustmentsList: async (filters) => {
        try {
            const whereClause = {
                location_code: filters.locationCode
            };

            if (filters.fromDate && filters.toDate) {
                whereClause.adjustment_date = {
                    [Op.between]: [filters.fromDate, filters.toDate]
                };
            }

            if (filters.adjustmentType) {
                whereClause.adjustment_type = filters.adjustmentType;
            }

            if (filters.externalSource) {
                whereClause.external_source = filters.externalSource;
            }

            if (filters.status) {
                whereClause.status = filters.status;
            }

            const adjustments = await Adjustments.findAll({
                where: whereClause,
                order: [['adjustment_date', 'DESC'], ['creation_date', 'DESC']],
                limit: filters.limit || 100
            });

            return adjustments;
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

    // Reverse an adjustment (set status to REVERSED)
    reverseAdjustment: async (adjustmentId, updatedBy) => {
        try {
            const result = await Adjustments.update(
                { 
                    status: 'REVERSED',
                    updated_by: updatedBy,
                    updation_date: new Date()
                },
                {
                    where: { adjustment_id: adjustmentId }
                }
            );
            return result;
        } catch (error) {
            console.error('Error reversing adjustment:', error);
            throw error;
        }
    },

    // Create a reversal entry (opposite of original)
    createReversalEntry: async (originalAdjustment, reversedBy) => {
        try {
            // Create opposite entry
            const reversalData = {
                adjustment_date: new Date().toISOString().split('T')[0], // Today's date
                location_code: originalAdjustment.location_code,
                reference_no: `REV-${originalAdjustment.adjustment_id}`,
                description: `Reversal of: ${originalAdjustment.description}`,
                external_id: originalAdjustment.external_id,
                external_source: originalAdjustment.external_source,
                ledger_name: originalAdjustment.ledger_name,
                // Swap debit and credit amounts
                debit_amount: originalAdjustment.credit_amount || null,
                credit_amount: originalAdjustment.debit_amount || null,
                adjustment_type: 'REVERSAL',
                status: 'ACTIVE',
                created_by: reversedBy,
                updated_by: reversedBy
            };

            const reversalEntry = await Adjustments.create(reversalData);
            return reversalEntry;
        } catch (error) {
            console.error('Error creating reversal entry:', error);
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

     canModifyAdjustment: async (adjustmentId) => {
        try {
            const adjustment = await Adjustments.findByPk(adjustmentId);
            if (!adjustment) {
                return { canModify: false, reason: 'Adjustment not found' };
            }

            if (adjustment.status === 'REVERSED') {
                return { canModify: false, reason: 'Adjustment is already reversed' };
            }

            // Get max days from config (global or location-specific)
            const maxDays = Number(await locationConfig.getLocationConfigValue(
                adjustment.location_code,
                'ADJUSTMENT_MODIFY_MAX_DAYS',
                30  // default fallback
            ));

            const daysDiff = Math.floor((new Date() - new Date(adjustment.adjustment_date)) / (1000 * 60 * 60 * 24));
            if (daysDiff > maxDays) {
                return { canModify: false, reason: `Cannot modify adjustments older than ${maxDays} days` };
            }

            return { canModify: true, reason: null };
        } catch (error) {
            console.error('Error checking if adjustment can be modified:', error);
            throw error;
        }
    }
};