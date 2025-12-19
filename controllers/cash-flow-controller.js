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
        } else {
            // Handle unauthorized access or not found
            const error = {
                status: 403,
                stack: 'Unauthorized access attempt to cashflow from different location'
            };
            return res.status(403).render('error', {
                user: req.user,
                message: 'Unauthorized: You cannot access cashflow records from other locations',
                error: error
            });
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
                            { error: "Cannot Generate Cashflow for " + dateFormat(generateDate, 'dd-mm-yyyy') + ". Please ensure Cashflow is closed for " + dateFormat(previousDateString) });
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



   deleteCashFlowClosing: async (req, res, next) => {
    const cashflowId = req.query.id;
    const userLocation = req.user.location_code;

    try {
        // SECURITY: Validate that cashflow belongs to user's location
        const cashflow = await cashflowDao.findCashflow(userLocation, cashflowId);
        
        if (!cashflow) {
            return res.status(403).json({ 
                error: 'Unauthorized: You cannot delete cashflow records from other locations' 
            });
        }

        // Proceed with deletion if validation passes
        await cashflowDao.deleteCashFlow(cashflowId);
        res.status(200).send({message: 'The cashflow closing is deleted successfully.'});
    } catch (error) {
        console.error('Error deleting cashflow:', error);
        res.status(500).send({error: 'Error while deleting the record.'});
    }
},
    closeData: async (req, res, next) => {
    const cashflowId = req.query.id;
    const userLocation = req.user.location_code;

    try {
        // SECURITY: Validate that cashflow belongs to user's location
        const cashflow = await cashflowDao.findCashflow(userLocation, cashflowId);
        
        if (!cashflow) {
            return res.status(403).json({ 
                    error: 'Unauthorized: You cannot close cashflow records from other locations' 
                });
            }

            // Proceed with closing if validation passes
            const result = await cashflowDao.finishClosing(cashflowId);
            
            if(result == 1) {
                res.status(200).send({message: 'The closing record is made final.'});
            } else {
                res.status(500).send({error: 'Error while closing the record.'});
            }
        } catch (error) {
            console.error('Error closing cashflow:', error);
            res.status(500).send({error: 'Error while closing the record.'});
        }
    },
// Add these methods to module.exports in controllers/cash-flow-controller.js

reopenCashflow: async (req, res, next) => {
    const cashflowId = req.query.id;
    const locationCode = req.user.location_code;
    const username = req.user.User_Name;
    const userId = req.user.Person_id;

    try {
        // Check if user has permission (SuperUser or GOBI-INC)
        const isSuperUser = req.user.Role === 'SuperUser';
        const isGobiInc = username === 'GOBI-INC';

        if (!isSuperUser && !isGobiInc) {
            return res.status(403).json({
                error: 'You do not have access to reopen cashflows.'
            });
        }

        // Validate cashflow belongs to user's location
        const cashflow = await cashflowDao.findCashflow(locationCode, cashflowId);
        
        if (!cashflow) {
            return res.status(403).json({ 
                error: 'Unauthorized: You cannot reopen cashflow records from other locations' 
            });
        }

        // Check if cashflow can be reopened
        const canReopen = await cashflowDao.canReopenCashflow(cashflowId, locationCode);

        if (!canReopen.canReopen) {
            return res.status(400).json({
                error: canReopen.reason
            });
        }

        // Reopen the cashflow
        const result = await cashflowDao.reopenCashflow(cashflowId, locationCode, userId);

        if (result > 0) {
            res.status(200).json({
                message: 'Cashflow reopened successfully. Status changed to DRAFT.'
            });
        } else {
            res.status(500).json({
                error: 'Failed to reopen cashflow. Please try again.'
            });
        }

    } catch (error) {
        console.error('Error reopening cashflow:', error);
        res.status(500).json({
            error: 'Error while reopening the cashflow.'
        });
    }
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


function getCashFlowDetailsPromise(cashflowDetails, req, res, next) {
    Promise.allSettled([
        cashflowDetails,
        cashflowDao.findCashflowTxnById(req.user.location_code, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[0])),
        cashflowDao.findCashflowTxnById(req.user.location_code, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[1])),
        cashFlowTxnDenominationPromise(req.query.id),
        getClosingDataForCashflow(req.query.id, req.user.location_code) // Add this new promise
    ]).then(values => {
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
            debitOptions: debitData.options,
            shiftClosings: values[4].value || [] // Add the closing data
        });
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

function getClosingDataForCashflow(cashflowId, locationCode) {
    return new Promise((resolve, reject) => {        
        cashflowDao.findClosingsByCashflowId(locationCode, cashflowId)
            .then(closings => {                
                const closingData = closings.map(closing => {
                    return {
                        closing_id: closing.closing_id,
                        closing_date: closing.closing_date,
                        cashier_name: closing.cashier_name || closing.Person_Name, 
                        total_collection: parseFloat(closing.total_collection || 0),
                        cash_amount: closing.cash,
                        notes: closing.notes,
                        status: closing.closing_status
                    };
                });
                resolve(closingData);
            })
            .catch(err => reject(err));
    });
}
