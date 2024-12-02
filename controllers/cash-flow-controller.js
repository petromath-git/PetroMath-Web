const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const cashflowDao = require("../dao/cashflow-closing-dao");
const TxnReadDao = require("../dao/txn-read-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");

module.exports = {
    getCashFlowHome: (req, res, next) => {
        gatherCashflowClosings(req.query.cashflow_fromDate, req.query.cashflow_toDate, req.user,
            res, next, {});
    },
    getCashFlowEntry: (req, res, next) => {
        cashflowDao.findCashflow(req.user.location_code, req.query.id).then(data => {
            if (data) {
                if (data.status === 'CLOSED') {
                    getCashFlowDetailsPromise(data, req, res, next)
                } else {
                    cashflowDao.triggerGenerateCashflow(req.query.id).then(() => {
                        getCashFlowDetailsPromise(data, req, res, next)
                    }).catch((err) => {
                        gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
                            req.body.cashflow_toDate_hiddenValue, req.user, res, next,
                            { error: "Error while triggering procedure." });
                    });
                }
            }
        });
    },
    triggerCashSalesByDate: (req, res, next) => {
        let locationCode = req.user.location_code;
        const generateDate = new Date(req.body.generateDate);
        const previousDate = new Date(generateDate);
        previousDate.setDate(generateDate.getDate() - 1);
        const previousDateString = previousDate.toISOString().split('T')[0];

        cashflowDao.findCashflowClosingsWithSpecificDate(locationCode, previousDateString).then(previousData => {
            if (previousData.length == 1 && previousData[0].status === 'CLOSED') {
                cashflowDao.findCashflowClosingsWithSpecificDate(locationCode, req.body.generateDate).then(data => {
                    if (data && data.length == 1) {
                        if (data[0].status === 'CLOSED') {
                            // Do nothing if the date has a closed record.
                            gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
                                req.body.cashflow_toDate_hiddenValue, req.user, res, next,
                                { warning: "The record is already closed." });
                        } else {
                            // Trigger procedure and get the next page cashflow details.
                            triggerAndGetCashflowData(data[0].cashflowId, req, res, next);
                        }
                    } else {
                        // Create cashflow closing, pass the id to procedure, then get the next page cashflow details.
                        cashflowDao.addNew({
                            'location': req.user.location_code,
                            'status': 'DRAFT',
                            'cashflow_date': req.body.generateDate,
                            'created_by': req.user.Person_id,
                        }).then((newData) => {
                            if (newData) {
                                triggerAndGetCashflowData(newData.cashflowId, req, res, next);
                            }
                        }).catch(err => {
                            console.error('Error creating new cashflow:', err);
                            next(err);
                        });
                    }
                })
            } else {
                cashflowDao.NewBunk(locationCode).then(data => {
                    if (data[0] != null) {
                        gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
                            req.body.cashflow_toDate_hiddenValue, req.user, res, next,
                            { error: "Cannot Generate Cashflow for " + dateFormat(generateDate, 'dd-mm-yyyy') + ". Please ensure Cashflow is closed for " + previousDateString });
                    } else if (data[0] == null) {
                        cashflowDao.addNew({
                            'location': req.user.location_code,
                            'status': 'DRAFT',
                            'cashflow_date': req.body.generateDate,
                            'created_by': req.user.Person_id,
                        }).then((newData) => {
                            if (newData) {
                                triggerAndGetCashflowData(newData.cashflowId, req, res, next);
                            }
                        }).catch(err => {
                            console.error('Error creating new cashflow:', err);
                            next(err);
                        });
                    }
                });
            }
        })
    },
    checkCashFlowClosingStatus: (locationCode, txnReceiptDate) => {
        // console.log('Checking cash flow closing status for date:', txnReceiptDate);
        return cashflowDao.findCashflowClosingsWithSpecificDate(locationCode, txnReceiptDate);
    },
    cashFlowTxnDenominationPromise: (closingId) => {
        return cashFlowTxnDenominationPromise(closingId);
    },
    saveCashflowTxnData: (req, res, next) => {
        const txnData = req.body;
        if (txnData) {
            txnCashflowSavePromise(txnData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved cash flow transaction data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },
    saveCashflowDenomsData: (req, res, next) => {
        const denomsData = req.body;
        if (denomsData) {
            txnCashflowDenomsSavePromise(denomsData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved cash flow denomination data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },
    deleteCashFlow: (req, res, next) => {
        if(req.query.id) {
            cashflowDao.delete(req.query.id)
                .then(data => {
                    if (data == 1) {
                        res.status(200).send({message: 'Cash flow successfully deleted.'});
                    } else {
                        res.status(500).send({error: 'Cash flow deletion failed or not available to delete.'});
                    }
                });
        } else {
            res.status(500).send({error: 'Cash flow deletion failed or not available to delete.'});
        }
    },
    deleteCashFlowClosing: (req, res, next) => {
        if(req.query.id) {
            cashflowDao.deleteCashFlow(req.query.id).then(() => {
                res.status(200).send({message: 'The cash-flow record is deleted successfully.'});
            }).error((err) => {
                res.status(500).send({error: 'Error while deleting the cash-flow record.'});
            });
        }
    },
    closeData: (req, res, next) => {
        cashflowDao.finishClosing(req.query.id).then(
            (data) => {
                if(data == 1) {
                    res.status(200).send({message: 'The closing record is made final.'});
                } else {
                    res.status(500).send({error: 'Error while closing the record.'});
                }
            });
    },
};

function getManagerNames(closingValues, cashflowDate, personData) {
    let managers = '', managerName = '';
    if (closingValues) {
        closingValues.forEach((closing) => {
            if (cashflowDate == closing.closing_date_fmt1) {
                managerName = utils.getPersonName(closing.closer_id, personData);
                if(!managers.includes(managerName)) {
                    if(managers.length > 0) {
                        managers += ", ";
                    }
                    managers += managerName;
                }
            }
        });
    }
    return managers.toString();
}

function collectCreditAndDebits(tableJoinData) {
    let creditOrDebits = [], options = [];
    if(tableJoinData) {
        tableJoinData.forEach((data) => {
            options.push({id: data.lookup_id, name: data.description});
            let t_cashflows = data.t_cashflow_transactions;
            if (t_cashflows && t_cashflows.length > 0) {
                t_cashflows.forEach((t_cashflow) => {
                    creditOrDebits.push({
                        txn_id: t_cashflow.transaction_id,
                        description: t_cashflow.description,
                        amount: t_cashflow.amount,
                        type: t_cashflow.type,
                        calcFlag: t_cashflow.calcFlag
                    });
                });
            }
        });
    }
    return {data : creditOrDebits, options: options};
}


function getCashFlowDetailsPromise (cashflowDetails, req, res, next) {
    Promise.allSettled([
        cashflowDetails,
        cashflowDao.findCashflowTxnById(req.user.location_code, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[0])),
        cashflowDao.findCashflowTxnById(req.user.location_code, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[1])),
        cashFlowTxnDenominationPromise(req.query.id)
    ]).then( values => {
        const creditData = collectCreditAndDebits(values[1].value);
        const debitData = collectCreditAndDebits(values[2].value);
        res.render('cash-flow', {
            title: "CashFlow : " + dateFormat(values[0].value.cashflow_date, 'dd-mmm-yyyy'),
            user: req.user,
            config: config,
            cashFlowStatus: values[0].value.status,
            cashFlowDenoms: values[3].value,
            cashflowId: req.query.id,
            cashFlowCredits: creditData.data,
            cashFlowDebits: debitData.data,
            creditOptions: creditData.options,
            debitOptions: debitData.options,});
    });
}

function gatherCashflowClosings(fromDate, toDate, user, res, next, messagesOptional) {
    if(fromDate === undefined) fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    if(toDate === undefined) toDate = dateFormat(new Date(), "yyyy-mm-dd");
    Promise.allSettled([cashflowDao.findCashflowClosings(user.location_code, fromDate, toDate),
    TxnReadDao.getClosingDetailsByDateFormat(user.location_code, fromDate, toDate)]).then(values => {
        let cashflowValues = [];
        if(values[0].value) {
            const personData = appCache.getPersonCache();
            values[0].value.forEach(cashflow => {
                cashflowValues.push({
                    cashflowId: cashflow.cashflowId,
                    status: cashflow.status,
                    notes: cashflow.notes,
                    date: dateFormat(cashflow.cashflow_date, 'dd-mmm-yyyy'),
                    managers: getManagerNames(values[1].value, cashflow.cashflow_date, personData)
                });
            });
        }
        res.render('cash-flow-home', {
            title: "CashFlow:Home", user: user,
            fromDate: fromDate, toDate: toDate,
            cashflowValues: cashflowValues,
            generateDate : utils.currentDate(), currentDate: utils.currentDate(),
            messages: messagesOptional});
    });
}

function triggerAndGetCashflowData(cashflowId, req, res, next) {
    cashflowDao.triggerGenerateCashflow(cashflowId).then( () =>
    {
        res.redirect("/cashflow?id=" + cashflowId);
    }).catch((err) => {
        gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
            req.body.cashflow_toDate_hiddenValue, req.user, res, next,
            {error: "Error while triggering procedure."});
    });
}

const txnCashflowSavePromise = (txnsArr) => {
    return new Promise((resolve, reject) => {
        cashflowDao.saveCashflowTxns(txnsArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
                console.error("Error while saving cash flow transaction " + err.toString() + err.error);
            resolve({error: err.toString()});
            });
    });
}

const txnCashflowDenomsSavePromise = (txnsArr) => {
    return new Promise((resolve, reject) => {
        cashflowDao.saveDenoms(txnsArr)
            .then(data => {
                resolve(data);
            }).catch((err) => {
                console.error("Error while saving cash flow denoms" + err.toString() + err.error);
            resolve({error: err.toString()});
            });
    });
}


const cashFlowTxnDenominationPromise = (cashFlowId) => {
    return new Promise((resolve, reject) => {
        cashflowDao.getDenomsByCashFlowId(cashFlowId)
            .then(data => {
                if (data && data.length > 0) {
                    let denominations = [];
                    config.cashFlowDenominationValues.forEach( (keyValue) => {
                        const denomination = getDenomTxn(keyValue.id, data);
                        if(denomination) {
                            denominations.push({
                                denomTxnId: denomination.cashdenom_id,
                                id: denomination.denomination,
                                label: keyValue.label,
                                denominationCnt: denomination.denomcount
                            });
                        } else {
                            denominations.push({
                                id: keyValue.id,
                                label: keyValue.label,
                            });
                        }
                    });
                    resolve(denominations);
                } else {
                    resolve(config.cashFlowDenominationValues);
                }
            });
    });
}

function getDenomTxn(id, denominationTxn) {
    let returnTxn = null;
    denominationTxn.forEach((denomination) => {
        if(denomination.denomination === id) {
            returnTxn = denomination;
        }
    });
    return returnTxn;
}

