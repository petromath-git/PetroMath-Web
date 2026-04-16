const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const BankStatementDao = require("../dao/bank-statement-dao");
const locationConfigDao = require('../dao/location-config-dao');
const bankReconDao = require('../dao/bank-reconciliation-dao');

module.exports = {
    getStatementData: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            let fromDate = req.query.tbankfromDate || dateFormat(new Date(), "yyyy-mm-dd");
            let toDate = req.query.tbanktoDate || dateFormat(new Date(), "yyyy-mm-dd");
            let bankId = req.query.bank_id || 0;

            // Get configuration for manual transactions (default: true if not configured)
            const [allowManualSetting, allowReclassifySetting, allowSplitSetting] = await Promise.all([
                locationConfigDao.getSetting(locationCode, 'ALLOW_MANUAL_BANK_TRANSACTIONS'),
                locationConfigDao.getSetting(locationCode, 'ALLOW_BANK_RECLASSIFY'),
                locationConfigDao.getSetting(locationCode, 'ALLOW_BANK_SPLIT')
            ]);
            const allowManual = allowManualSetting === null || allowManualSetting === undefined ? 'true' : allowManualSetting;
            const allowReclassify = allowReclassifySetting === null || allowReclassifySetting === undefined ? 'true' : allowReclassifySetting;
            // Split is disabled by default — must be explicitly enabled per location
            const allowSplit = allowSplitSetting === 'true' ? 'true' : 'false';

            const [accountList, locationData, transactionList, transactionTypes, accountingTypes, ledgerList] = await Promise.all([
                BankStatementDao.getBankAccounts(locationCode),
                BankStatementDao.getLocationId(locationCode),
                BankStatementDao.getTransactionsByDate(locationCode, fromDate, toDate, bankId),
                BankStatementDao.getTransactionTypes(),
                BankStatementDao.getAccountingTypes(),
                bankId && bankId != 0 ? BankStatementDao.getAllowedLedgers(bankId, locationCode) : Promise.resolve([])
            ]);

            res.render('bank-statement', {
                user: req.user,
                title: 'Bank Statement',
                config: config.APP_CONFIGS,
                allowManualBankTransactions: allowManual,
                allowBankReclassify: allowReclassify,
                allowBankSplit: allowSplit,
                fromDate: fromDate,
                toDate: toDate,
                bankId: bankId,
                currentDate: utils.currentDate(),
                locationcode: locationCode,
                accountList: accountList,
                location_id: locationData.location_id,
                transactionList: transactionList,
                TxnTypes: transactionTypes,
                AcctTypes: accountingTypes,
                ledgerList: ledgerList
            });
        } catch (error) {
            console.error('Error fetching bank statement data:', error);
            next(error);
        }
    },

   saveTransactionData: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const createdBy    = req.user.Person_id || req.user.username;
        const usedIndices  = Object.keys(req.body)
            .filter(key => key.startsWith('trans_date_'))
            .map(key => key.replace('trans_date_', ''));

        for (const index of usedIndices) {
            const credit = parseFloat(req.body[`creditamount_${index}`] || 0);
            const debit  = parseFloat(req.body[`debitamount_${index}`]  || 0);

            if (credit === 0 && debit === 0) {
                return res.status(400).send({ error: `Row ${parseInt(index) + 1} must have either credit or debit amount.` });
            }
            if (credit > 0 && debit > 0) {
                return res.status(400).send({ error: `Row ${parseInt(index) + 1} cannot have both credit and debit amounts.` });
            }

            const bankId  = req.body[`bank_id_${index}`];
            const isSplit = req.body[`is_split_${index}`] === 'Y';

            if (isSplit) {
                // ── Split at upload time ──────────────────────────────────
                // Save parent with no ledger (no receipt created), then call
                // saveSplits which handles receipt creation + is_split flag.
                const parentData = {
                    trans_date:       req.body[`trans_date_${index}`],
                    bank_id:          bankId,
                    ledger_name:      null,
                    transaction_type: req.body[`transaction_type_${index}`] || null,
                    accounting_type:  req.body[`accounting_type_${index}`]  || null,
                    credit_amount:    credit || null,
                    debit_amount:     debit  || null,
                    remarks:          req.body[`remarks_${index}`]      || '',
                    user_remark:      req.body[`user_remark_${index}`]  || null,
                    external_id:      null,
                    external_source:  null,
                    running_balance:  null,
                    created_by:       createdBy
                };
                const saveResult = await BankStatementDao.saveTransaction(parentData);
                const tBankId   = saveResult[0]; // LAST_INSERT_ID

                // Collect split allocations from form fields
                const splits = [];
                let splitIdx = 0;
                while (req.body[`split_ledger_${index}_${splitIdx}`]) {
                    const ledgerName = req.body[`split_ledger_${index}_${splitIdx}`];
                    const amount     = parseFloat(req.body[`split_amount_${index}_${splitIdx}`] || 0);
                    const remarks    = req.body[`split_remarks_${index}_${splitIdx}`] || null;
                    const details    = await BankStatementDao.getLedgerDetails(bankId, ledgerName, locationCode);
                    splits.push({
                        ledger_name:     ledgerName,
                        external_id:     details ? details.external_id  : null,
                        external_source: details ? details.source_type  : null,
                        amount,
                        remarks
                    });
                    splitIdx++;
                }
                await BankStatementDao.saveSplits(tBankId, splits, bankId, locationCode, createdBy);

            } else {
                // ── Normal (non-split) row ────────────────────────────────
                const ledgerName = req.body[`ledger_name_${index}`] || null;
                let externalId = null, externalSource = null;
                if (ledgerName && bankId) {
                    const details = await BankStatementDao.getLedgerDetails(bankId, ledgerName, locationCode);
                    if (details) { externalId = details.external_id; externalSource = details.source_type; }
                }
                await BankStatementDao.saveTransaction({
                    trans_date:       req.body[`trans_date_${index}`],
                    bank_id:          bankId,
                    ledger_name:      ledgerName,
                    transaction_type: req.body[`transaction_type_${index}`] || null,
                    accounting_type:  req.body[`accounting_type_${index}`]  || null,
                    credit_amount:    credit || null,
                    debit_amount:     debit  || null,
                    remarks:          req.body[`remarks_${index}`]      || '',
                    user_remark:      req.body[`user_remark_${index}`]  || null,
                    external_id:      externalId,
                    external_source:  externalSource,
                    running_balance:  null,
                    created_by:       createdBy
                });
            }
        }

        res.redirect(`/bank-statement?tbankfromDate=${req.body.tbank_fromDate_hiddenValue}&tbanktoDate=${req.body.tbank_toDate_hiddenValue}&bank_id=${req.body.bank_id || 0}`);
    } catch (error) {
        console.error('Error saving bank transactions:', error);
        res.status(500).send({ error: 'Failed to save transactions.' });
    }
},



    deleteTransaction: async (req, res, next) => {
        try {
            const tBankId = req.params.id;

            const transaction = await BankStatementDao.getTransactionById(tBankId);
            if (transaction && transaction.closed_flag === 'Y') {
                return res.status(400).json({ 
                    error: 'Cannot delete closed transaction' 
                });
            }

            await BankStatementDao.deleteTransaction(tBankId);
            
            res.status(200).send({ message: 'Transaction deleted successfully.' });
        } catch (error) {
            console.error('Error deleting bank transaction:', error);
            res.status(500).send({ error: 'Failed to delete transaction.' });
        }
    },

    reclassifyTransaction: async (req, res, next) => {
        try {
            const tBankId = req.params.id;
            const { ledger_name, bank_id } = req.body;
            const locationCode = req.user.location_code;

            if (!ledger_name || !bank_id) {
                return res.status(400).json({ error: 'ledger_name and bank_id are required' });
            }

            // Block if the transaction already has downstream dependencies:
            //   'Credit'   → auto-receipt created; would leave dangling receipt
            //   'Supplier' → supplier reconciliation may reference external_id
            //   is_split   → allocations live in splits table; use DELETE /splits then re-split
            const txn = await BankStatementDao.getTransactionById(tBankId);
            if (txn && txn.is_split === 'Y') {
                return res.status(400).json({
                    error: 'Cannot reclassify: this transaction has been split. Remove the split first, then reclassify.'
                });
            }
            if (txn && ['Credit', 'Supplier'].includes(txn.external_source)) {
                return res.status(400).json({
                    error: `Cannot reclassify: this transaction is already linked to a ${txn.external_source} ledger with downstream records. Delete and re-enter it with the correct ledger.`
                });
            }

            const ledgerDetails = await BankStatementDao.getLedgerDetails(bank_id, ledger_name, locationCode);
            const newSource = ledgerDetails ? ledgerDetails.source_type : null;

            // If reclassifying TO a Credit ledger on a credit transaction,
            // create the receipt the same way saveTransaction would have.
            const createReceipt = newSource === 'Credit' && parseFloat(txn.credit_amount) > 0;

            const locationData = await BankStatementDao.getLocationId(locationCode);

            await BankStatementDao.reclassifyTransaction({
                t_bank_id:       tBankId,
                ledger_name,
                external_id:     ledgerDetails ? ledgerDetails.external_id : null,
                external_source: newSource,
                create_receipt:  createReceipt,
                location_code:   locationCode,
                receipt_date:    txn.trans_date,
                credit_amount:   txn.credit_amount,
                created_by:      req.user.Person_id || req.user.username
            });

            // Update ML suggestion cache (fire-and-forget)
            const entryType = parseFloat(txn.credit_amount) > 0 ? 'CREDIT' : 'DEBIT';
            bankReconDao.learnFromSuggestion(parseInt(bank_id), txn.remarks || '', ledger_name, entryType)
                .catch(err => console.error('learnFromSuggestion error (reclassify):', err));

            res.status(200).json({ success: true, ledger_name, source_type: newSource });
        } catch (error) {
            console.error('Error reclassifying transaction:', error);
            res.status(500).json({ error: 'Failed to reclassify transaction.' });
        }
    },

    // API endpoint to get allowed ledgers when bank is changed
    getLedgersForBank: async (req, res, next) => {
        try {
            const bankId = req.query.bank_id;
            const locationCode = req.user.location_code;

            if (!bankId) {
                return res.status(400).json({ error: 'Bank ID is required' });
            }

            const ledgers = await BankStatementDao.getAllowedLedgers(bankId, locationCode);
            
            res.status(200).json({ success: true, ledgers: ledgers });
        } catch (error) {
            console.error('Error fetching ledgers for bank:', error);
            res.status(500).json({ error: 'Failed to fetch ledgers' });
        }
    },

    getBanksForLocation: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const banks = await BankStatementDao.getBankAccounts(locationCode);
            
            res.status(200).json({ success: true, banks: banks });
        } catch (error) {
            console.error('Error fetching bank accounts:', error);
            res.status(500).json({ error: 'Failed to fetch banks' });
        }
    },

    bulkReclassifyTransactions: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const { t_bank_ids, ledger_name, bank_id } = req.body;

            if (!Array.isArray(t_bank_ids) || t_bank_ids.length === 0) {
                return res.status(400).json({ error: 'No transactions selected' });
            }
            if (!ledger_name || !bank_id) {
                return res.status(400).json({ error: 'ledger_name and bank_id are required' });
            }

            // Fetch all transactions and check none are locked
            const txns = [];
            for (const tBankId of t_bank_ids) {
                const txn = await BankStatementDao.getTransactionById(tBankId);
                if (!txn) continue;
                if (['Credit', 'Supplier'].includes(txn.external_source)) {
                    return res.status(400).json({
                        error: `Transaction ${tBankId} is already linked to a ${txn.external_source} ledger and cannot be reclassified.`
                    });
                }
                txns.push(txn);
            }

            const ledgerDetails = await BankStatementDao.getLedgerDetails(bank_id, ledger_name, locationCode);
            const newSource = ledgerDetails ? ledgerDetails.source_type : null;
            const newExternalId = ledgerDetails ? ledgerDetails.external_id : null;

            const bulkUpdates = txns.map(txn => ({
                t_bank_id: txn.t_bank_id,
                ledger_name,
                external_id: newExternalId,
                external_source: newSource,
                create_receipt: newSource === 'Credit' && parseFloat(txn.credit_amount) > 0,
                location_code: locationCode,
                receipt_date: txn.trans_date,
                credit_amount: txn.credit_amount,
                created_by: req.user.Person_id || req.user.username
            }));

            await BankStatementDao.bulkReclassifyTransactions(bulkUpdates);

            // Update ML suggestion cache for each transaction (fire-and-forget)
            for (const txn of txns) {
                const entryType = parseFloat(txn.credit_amount) > 0 ? 'CREDIT' : 'DEBIT';
                bankReconDao.learnFromSuggestion(parseInt(bank_id), txn.remarks || '', ledger_name, entryType)
                    .catch(err => console.error('learnFromSuggestion error (bulk reclassify):', err));
            }

            res.status(200).json({ success: true, updated: bulkUpdates.length, source_type: newSource });
        } catch (error) {
            console.error('Error bulk reclassifying transactions:', error);
            res.status(500).json({ error: 'Failed to bulk reclassify transactions.' });
        }
    },

    // ── Split transaction handlers ─────────────────────────────────────────────

    // GET /bank-statement/:id/splits
    // Returns split-eligible ledgers for this transaction AND any existing splits.
    getSplits: async (req, res, next) => {
        try {
            const tBankId     = req.params.id;
            const locationCode = req.user.location_code;

            const txn = await BankStatementDao.getTransactionById(tBankId);
            if (!txn) return res.status(404).json({ error: 'Transaction not found.' });

            const entryType = parseFloat(txn.credit_amount) > 0 ? 'CREDIT' : 'DEBIT';

            const [eligibleLedgers, existingSplits] = await Promise.all([
                BankStatementDao.getSplitEligibleLedgers(txn.bank_id, locationCode, entryType),
                BankStatementDao.getSplitsForTransaction(tBankId)
            ]);

            res.status(200).json({
                success: true,
                transaction: {
                    t_bank_id:     txn.t_bank_id,
                    trans_date:    txn.trans_date,
                    credit_amount: txn.credit_amount,
                    debit_amount:  txn.debit_amount,
                    remarks:       txn.remarks,
                    is_split:      txn.is_split
                },
                eligible_ledgers: eligibleLedgers,
                existing_splits:  existingSplits
            });
        } catch (error) {
            console.error('Error fetching splits:', error);
            res.status(500).json({ error: 'Failed to fetch splits.' });
        }
    },

    // POST /bank-statement/:id/splits
    // Body: { splits: [{ ledger_name, external_id, external_source, amount, remarks }] }
    // Replaces any prior split for this transaction (idempotent re-split).
    saveSplits: async (req, res, next) => {
        try {
            const tBankId      = req.params.id;
            const locationCode  = req.user.location_code;
            const createdBy     = req.user.Person_id || req.user.username;
            const { splits }    = req.body;

            if (!Array.isArray(splits) || splits.length === 0) {
                return res.status(400).json({ error: 'splits array is required and must not be empty.' });
            }

            const txn = await BankStatementDao.getTransactionById(tBankId);
            if (!txn) return res.status(404).json({ error: 'Transaction not found.' });

            await BankStatementDao.saveSplits(tBankId, splits, txn.bank_id, locationCode, createdBy);

            res.status(200).json({ success: true, split_count: splits.length });
        } catch (error) {
            console.error('Error saving splits:', error);
            // Expose validation errors (amount mismatch, ineligible ledger) as 400
            const isValidationError = error.message &&
                (error.message.includes('does not match') || error.message.includes('not eligible'));
            res.status(isValidationError ? 400 : 500).json({ error: error.message || 'Failed to save splits.' });
        }
    },

    // DELETE /bank-statement/:id/splits
    // Removes all splits and resets the transaction to unclassified.
    deleteSplits: async (req, res, next) => {
        try {
            const tBankId = req.params.id;

            const txn = await BankStatementDao.getTransactionById(tBankId);
            if (!txn) return res.status(404).json({ error: 'Transaction not found.' });
            if (txn.is_split !== 'Y') {
                return res.status(400).json({ error: 'Transaction is not split.' });
            }

            await BankStatementDao.deleteSplits(tBankId);

            res.status(200).json({ success: true });
        } catch (error) {
            console.error('Error deleting splits:', error);
            res.status(500).json({ error: 'Failed to delete splits.' });
        }
    },

    // API endpoint to get accounting type for a transaction type
    getAccountingType: async (req, res, next) => {
        try {
            const transactionTypes = await BankStatementDao.getTransactionTypes();
            const transType = req.query.trans_type;
            
            const result = transactionTypes.find(t => t.lookup_id == transType);
            
            if (result) {
                res.status(200).send({ 
                    message: 'Got data.', 
                    rowsData: result 
                });
            } else {
                res.status(400).send({ error: 'No results found.' });
            }
        } catch (error) {
            console.error('Error fetching accounting type:', error);
            res.status(500).send({ error: 'Failed to fetch accounting type.' });
        }
    }
};