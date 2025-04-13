const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const PersonDao = require("../dao/person-dao");
const BankAcctDao = require("../dao/txn-bankacct-dao");
const { getAccountingType } = require("../dao/txn-bankacct-dao");


module.exports = {
    getAccountData: (req, res) => {
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        
        let bankid;
        //let id=req.query.bank_id;
        //console.log(id);
        if(req.query.tbankfromDate) {
            fromDate = req.query.tbankfromDate;
        }
        if(req.query.tbanktoDate) {
            toDate = req.query.tbanktoDate;
        }

        if(req.query.bank_id) {
            bankid=req.query.bank_id;
        }
                
        Promise.allSettled([
            getBankAcctPromise(locationCode),
            getLocationId(locationCode),
            getTransactionTypePromise(),
            getBankTransactionByDate(locationCode,fromDate,toDate,bankid),
            geAccountingTypePromise(),
            getLedgerNamePromise(locationCode)  // 👈 new
            //getAccountingTypeMapPromise()
            ])
        .then((values) => {
        res.render('bank-transaction',{user: req.user,
            title:'Bank Transaction',
            config: config.APP_CONFIGS,
            fromDate: fromDate,
            toDate: toDate,
            bankId:bankid,
            currentDate: utils.currentDate(),
            locationcode: locationCode,
            accountList: values[0].value.accountList,
            location_id: values[1].value.location_id,
            TxnTypes:values[2].value,
            transactionList:values[3].value.transactionlist,
            AcctTypes: values[4].value,
            ledgerList: values[5].value
            //AccntTransMap: values[5].value
            });
        });
    },

    saveTransactionData: (req, res, next) => {
        BankAcctDao.create(dbMapping.newBankTransaction(req));
        res.redirect('/bank-transaction?tbankfromDate=' + req.body.tbank_fromDate_hiddenValue +
            '&tbanktoDate=' + req.body.tbank_toDate_hiddenValue);
    },
    
    deleteTransaction: (req, res, next) => {
        if(req.query.id) {
            BankAcctDao.delete(req.query.id)
                .then(data => {
                    if (data == 1) {
                        res.status(200).send({message: 'Bank Transaction successfully deleted.'});
                    } else {
                        res.status(500).send({error: 'Bank Transaction deletion failed or not available to delete.'});
                    }
                });
        } else {
            res.status(500).send({error: 'Bank Transaction failed or not available to delete.'});
        }
    },

    getAccountingType: (req, res, next) => {
        BankAcctDao.getAccountingTypeforId(req.query.trans_type).then((result) => {
            if (result && !result.error) {
                res.status(200).send({message: 'Got data.', rowsData: result});
            } else {
                res.status(400).send({error: result ? result.error : 'No results found.'});
            }
        });
    },
}

const getBankAcctPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let accountList = [];
        BankAcctDao.getAccountno(locationCode)
            .then(data => {
                data.forEach((account) => {
                    accountList.push({bank_id: account.bank_id, account_number: account.account_number, nickname:account.account_nickname});
                });
                
                resolve({accountList: accountList});
            });
            
    });
}

const getLocationId = (locationCode) => {
    return new Promise((resolve, reject) => {
        let location_id;
        BankAcctDao.getLocationId(locationCode)
            .then(data => {
               location_id = data.location_id;
                resolve({location_id:location_id});
            });

    });
}

const getLedgerNamePromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        BankAcctDao.getLedgerNames(locationCode)
            .then(data => {
                const ledgerList = data.map(row => ({
                    id: row.id,
                    name: row.ledger_name,
                    source: row.source_type
                }));
                resolve(ledgerList);
            })
            .catch(err => reject(err));
    });
}

const getTransactionTypePromise = () => {
    return new Promise((resolve, reject) => {
        let txnTypes = [];
            BankAcctDao.getTransactionType()
                .then(data => {
                    data.forEach((etype) => {
                        txnTypes.push({
                            id: etype.lookup_id,
                            txntype: etype.description,
                            attr: etype.attribute1
                    });
                });
                //let productMap = new Map();
                resolve(txnTypes);
            });
    });
}

const geAccountingTypePromise = () => {
    return new Promise((resolve, reject) => {
        let acctTypes = [];
            BankAcctDao.getAccountingType()
                .then(data => {
                    data.forEach((etype) => {
                        acctTypes.push({
                            attr: etype.attribute1
                    });

                });
                const uniqueacctType = [...new Map(acctTypes.map(item => [JSON.stringify(item), item])).values()];
                resolve(uniqueacctType);

            });
    });
}

// const getAccountingTypeMapPromise = () => {
//     return new Promise((resolve, reject) => {
//         let TransactionAccontMap = new Map();
//         BankAcctDao.getAccountingTypeforId()
//             .then(data => {
//                 data.forEach((etype) => {
//                     TransactionAccontMap.set(etype.description,etype.attribute1)
//             });
//             console.log(TransactionAccontMap);
//             resolve(TransactionAccontMap);
//         });

//     });
// }

const getBankTransactionByDate = (locationCode, fromDate,toDate,bankid) => {
    return new Promise((resolve, reject) => {
        let transactionlist=[];
        BankAcctDao.getTransactionByDate(locationCode,fromDate,toDate,bankid)
            .then(data => {
                data.forEach((transData) => {
                    transactionlist.push({
                        t_bank_id: transData.t_bank_id,
                        trans_date:dateFormat(transData.trans_date,"dd-mm-yyyy"),
                        bank_id:transData.bank_id,
                        bank_name:transData.bank_name,
                        account_number:transData.account_number,
                        account_nickname:transData.account_nickname,
                        location_id:transData.location_id,
                        credit_amount:transData.credit_amount,
                        debit_amount:transData.debit_amount,
                        closing_balance: transData.closing_bal,
                        transaction_type:transData.transaction_type,
                        accounting_type: transData.accounting_type,
                        ledger_name: transData.ledger_name,
                        remarks:transData.remarks,
                        closed_flag: transData.closed_flag
                    });
                });
                resolve({transactionlist:transactionlist});
            });
    });
}