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
            const [allowManualSetting, allowReclassifySetting] = await Promise.all([
                locationConfigDao.getSetting(locationCode, 'ALLOW_MANUAL_BANK_TRANSACTIONS'),
                locationConfigDao.getSetting(locationCode, 'ALLOW_BANK_RECLASSIFY')
            ]);
            const allowManual = allowManualSetting === null || allowManualSetting === undefined ? 'true' : allowManualSetting;
            const allowReclassify = allowReclassifySetting === null || allowReclassifySetting === undefined ? 'true' : allowReclassifySetting;

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
        const transactions = [];
        const usedIndices = Object.keys(req.body)
            .filter(key => key.startsWith('trans_date_'))
            .map(key => key.replace('trans_date_', ''));

        for (const index of usedIndices) {
            const credit = parseFloat(req.body[`creditamount_${index}`] || 0);
            const debit = parseFloat(req.body[`debitamount_${index}`] || 0);
            
            if (credit === 0 && debit === 0) {
                return res.status(400).send({
                    error: `Row ${parseInt(index) + 1} must have either credit or debit amount.`
                });
            }

            if (credit > 0 && debit > 0) {
                return res.status(400).send({
                    error: `Row ${parseInt(index) + 1} cannot have both credit and debit amounts.`
                });
            }

            const bankId = req.body[`bank_id_${index}`];
            const ledgerName = req.body[`ledger_name_${index}`] || null;
            
            // Lookup external_id and external_source from allowed ledgers
            let externalId = null;
            let externalSource = null;
            
            if (ledgerName && bankId) {
                const ledgerDetails = await BankStatementDao.getLedgerDetails(bankId, ledgerName, locationCode);
                if (ledgerDetails) {
                    externalId = ledgerDetails.external_id;
                    externalSource = ledgerDetails.source_type;
                }
            }

            const transactionData = {
                trans_date: req.body[`trans_date_${index}`],
                bank_id: bankId,
                ledger_name: ledgerName,
                transaction_type: req.body[`transaction_type_${index}`] || null,
                accounting_type: req.body[`accounting_type_${index}`] || null,
                credit_amount: credit || null,
                debit_amount: debit || null,
                remarks: req.body[`remarks_${index}`] || '',
                external_id: externalId,
                external_source: externalSource,
                running_balance: null,
                created_by: req.user.Person_id || req.user.username
            };

            transactions.push(transactionData);
        }

        // Save all transactions
        for (const transaction of transactions) {
            await BankStatementDao.saveTransaction(transaction);
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
            const txn = await BankStatementDao.getTransactionById(tBankId);
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