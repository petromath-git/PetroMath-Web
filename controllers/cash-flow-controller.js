const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const cashflowDao = require("../dao/cashflow-closing-dao");
const adjustmentsDao = require("../dao/adjustments-dao");
const config = require("../config/app-config").APP_CONFIGS;
const locationConfig = require("../utils/location-config");
const security = require("../utils/app-security");

module.exports = {
    getCashFlowHome: (req, res, next) => {
    const fromDate = req.query.cashflow_fromDate;
    const toDate = req.query.cashflow_toDate;

    if (fromDate && toDate) {
        gatherCashflowClosings(fromDate, toDate, req.user, res, next, {});
    } else {
        cashflowDao.findLatestCashflowDate(req.user.location_code).then(result => {
            const latestDate = (result && result[0] && result[0].latest_date) 
                ? result[0].latest_date 
                : utils.currentDate();
            
            const fromDateDefault = new Date(latestDate);
            fromDateDefault.setDate(fromDateDefault.getDate() - 4);
            const fromDateStr = dateFormat(fromDateDefault, 'yyyy-mm-dd');
            
            gatherCashflowClosings(fromDateStr, latestDate, req.user, res, next, {});
        }).catch(err => {
            gatherCashflowClosings(utils.currentDate(), utils.currentDate(), req.user, res, next, {});
        });
    }
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



    triggerCashSalesByDate: async (req, res, next) => {
        let locationCode = req.user.location_code;

        // With CASHFLOW_ENABLED off, receipts/advances/tank receipts are closed out
        // at save time (cashflow_date stamped), so a Day Close generated here would
        // silently miss them. Refuse before a DRAFT row is created.
        // generate_cashflow enforces the same gate at DB level.
        const cashflowEnabledRaw = await locationConfig.getLocationConfigValue(locationCode, 'CASHFLOW_ENABLED', 'false');
        if (String(cashflowEnabledRaw).toLowerCase() !== 'true') {
            return gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
                req.body.cashflow_toDate_hiddenValue, req.user, res, next,
                { error: "Cashflow is not enabled for this location (CASHFLOW_ENABLED), so Day Close cannot be generated. Please contact support." });
        }

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
    saveCashflowTxnData: async (req, res, next) => {
        const txnData = req.body;
        if (txnData && txnData.length > 0) {
            const validationError = await validateDigitalVendorRows(txnData, req.user.location_code)
                || await validateNoFreeTextCashReceipts(txnData)
                || await validateNoFreeTextSalaryLines(txnData);
            if (validationError) {
                return res.status(400).send({error: validationError});
            }
            const result = await txnCashflowSavePromise(txnData);
            if (!result.error) {
                try {
                    await syncDigitalVendorAdjustments(txnData, result, req.user.location_code);
                } catch (syncErr) {
                    return res.status(500).send({error: syncErr.message});
                }
                res.status(200).send({message: 'Saved cash flow transaction data successfully.', rowsData: result});
            } else {
                res.status(500).send({error: result.error});
            }
        }
    },
    // Cash Receipt lines entered on a DRAFT Day Close: each becomes a Cash
    // credit receipt for the chosen customer (dated on the Day Close), which
    // generate_cashflow then turns into the linked "Cash Receipt" line.
    saveDayCloseReceipts: async (req, res, next) => {
        try {
            const { cashflowId, receipts } = req.body || {};
            const cashflow = await cashflowDao.findCashflow(req.user.location_code, cashflowId);
            if (!cashflow) {
                return res.status(403).send({error: 'Unauthorized: this Day Close belongs to another location.'});
            }
            if (cashflow.status === 'CLOSED') {
                return res.status(400).send({error: 'This Day Close is already closed.'});
            }
            if (!Array.isArray(receipts) || receipts.length === 0) {
                return res.status(400).send({error: 'No cash receipts to save.'});
            }

            const customers = await cashflowDao.findCashReceiptCustomers(req.user.location_code);
            const customerIds = new Set(customers.map(c => String(c.creditlist_id)));
            const rows = [];
            for (const r of receipts) {
                const amount = Math.round((parseFloat(r.amount) || 0) * 100) / 100;
                if (!r.creditlist_id || !customerIds.has(String(r.creditlist_id))) {
                    return res.status(400).send({error: 'Please select a valid customer for every Cash Receipt line.'});
                }
                if (!(amount > 0)) {
                    return res.status(400).send({error: 'Cash Receipt amount must be greater than zero.'});
                }
                rows.push({
                    creditlistId: parseInt(r.creditlist_id, 10),
                    amount,
                    notes: r.notes ? String(r.notes).trim().substring(0, 500) : null,
                    replacesTxnId: parseInt(r.replaces_txn_id, 10) || null
                });
            }

            await cashflowDao.createDayCloseReceipts(cashflow, rows, req.user.User_Name);
            res.status(200).send({message: 'Saved ' + rows.length + ' cash receipt(s) to the customer ledger.'});
        } catch (err) {
            console.error('Error saving Day Close cash receipts:', err);
            const dbErr = err && (err.original || err.parent);
            const message = dbErr && dbErr.sqlState === '45000' ? dbErr.sqlMessage : 'Error while saving the cash receipts.';
            res.status(500).send({error: message});
        }
    },
    // Deletes a cash receipt that was entered from this (DRAFT) Day Close.
    deleteDayCloseReceipt: async (req, res, next) => {
        try {
            const receipt = await cashflowDao.findDayCloseReceipt(req.query.id);
            if (!receipt || !receipt.origin_cashflow_id || receipt.location_code !== req.user.location_code) {
                return res.status(404).send({error: 'Receipt not found or not entered from Day Close.'});
            }
            const cashflow = await cashflowDao.findCashflow(req.user.location_code, receipt.origin_cashflow_id);
            if (!cashflow || cashflow.status === 'CLOSED') {
                return res.status(400).send({error: 'This Day Close is closed; reopen it to remove the receipt.'});
            }
            if (receipt.recon_match_id || Number(receipt.manual_recon_flag) === 1) {
                return res.status(400).send({error: 'Cannot delete: this receipt is already bank-reconciled. Remove the reconciliation first.'});
            }
            await cashflowDao.deleteDayCloseReceipt(receipt.treceipt_id, receipt.origin_cashflow_id);
            res.status(200).send({message: 'Cash receipt deleted.'});
        } catch (err) {
            console.error('Error deleting Day Close cash receipt:', err);
            res.status(500).send({error: 'Error while deleting the cash receipt.'});
        }
    },
    // Salary lines (Salary Advance / Payout / Advance Recovery) entered on a
    // DRAFT Day Close: each becomes an employee ledger entry for the chosen
    // employee (dated on the Day Close; type from the Account Head), which
    // generate_cashflow then turns into the linked Day Close line.
    saveDayCloseEmployeeEntries: async (req, res, next) => {
        try {
            const { cashflowId, entries } = req.body || {};
            const cashflow = await cashflowDao.findCashflow(req.user.location_code, cashflowId);
            if (!cashflow) {
                return res.status(403).send({error: 'Unauthorized: this Day Close belongs to another location.'});
            }
            if (cashflow.status === 'CLOSED') {
                return res.status(400).send({error: 'This Day Close is already closed.'});
            }
            if (!Array.isArray(entries) || entries.length === 0) {
                return res.status(400).send({error: 'No employee entries to save.'});
            }

            const [employees, txnTypes] = await Promise.all([
                cashflowDao.findCashflowEmployees(req.user.location_code),
                cashflowDao.getAccountHeadEmployeeTxnTypes(
                    [...new Set(entries.map(e => parseInt(e.account_head_id, 10)).filter(id => !isNaN(id)))])
            ]);
            const employeeIds = new Set(employees.map(e => String(e.employee_id)));
            const rows = [];
            for (const e of entries) {
                const txnType = txnTypes.get(parseInt(e.account_head_id, 10));
                const amount = Math.round((parseFloat(e.amount) || 0) * 100) / 100;
                if (!txnType) {
                    return res.status(400).send({error: 'This transaction type is not an employee entry.'});
                }
                if (!e.employee_id || !employeeIds.has(String(e.employee_id))) {
                    return res.status(400).send({error: 'Please select a valid employee for every salary line.'});
                }
                if (!(amount > 0)) {
                    return res.status(400).send({error: 'Salary line amount must be greater than zero.'});
                }
                rows.push({
                    employeeId: parseInt(e.employee_id, 10),
                    txnType,
                    amount,
                    notes: e.notes ? String(e.notes).trim().substring(0, 255) : null,
                    replacesTxnId: parseInt(e.replaces_txn_id, 10) || null
                });
            }

            await cashflowDao.createDayCloseEmployeeEntries(cashflow, rows, req.user.User_Name);
            res.status(200).send({message: 'Saved ' + rows.length + ' employee entr' + (rows.length === 1 ? 'y' : 'ies') + ' to the employee ledger.'});
        } catch (err) {
            console.error('Error saving Day Close employee entries:', err);
            const dbErr = err && (err.original || err.parent);
            const message = dbErr && dbErr.sqlState === '45000' ? dbErr.sqlMessage : 'Error while saving the employee entries.';
            res.status(500).send({error: message});
        }
    },
    // Deletes an employee ledger entry that was entered from this (DRAFT) Day Close.
    deleteDayCloseEmployeeEntry: async (req, res, next) => {
        try {
            const entry = await cashflowDao.findDayCloseEmployeeEntry(req.query.id);
            if (!entry || !entry.origin_cashflow_id || entry.location_code !== req.user.location_code) {
                return res.status(404).send({error: 'Entry not found or not entered from Day Close.'});
            }
            const cashflow = await cashflowDao.findCashflow(req.user.location_code, entry.origin_cashflow_id);
            if (!cashflow || cashflow.status === 'CLOSED') {
                return res.status(400).send({error: 'This Day Close is closed; reopen it to remove the entry.'});
            }
            await cashflowDao.deleteDayCloseEmployeeEntry(entry.ledger_id, entry.origin_cashflow_id, req.user.User_Name);
            res.status(200).send({message: 'Employee entry deleted.'});
        } catch (err) {
            console.error('Error deleting Day Close employee entry:', err);
            res.status(500).send({error: 'Error while deleting the employee entry.'});
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
            const transactionId = req.query.id;
            adjustmentsDao.findActiveByCashflowTxnId(transactionId).then(linkedAdjustment => {
                const isReconciled = linkedAdjustment && (linkedAdjustment.manual_recon_flag || linkedAdjustment.recon_match_id);
                if (isReconciled) {
                    return res.status(400).send({error: `Cannot delete: the linked adjustment (#${linkedAdjustment.adjustment_id}) has already been bank-reconciled. Remove the reconciliation first.`});
                }
                const cleanup = linkedAdjustment ? adjustmentsDao.deleteAdjustment(linkedAdjustment.adjustment_id) : Promise.resolve();
                cleanup.then(() => {
                    cashflowDao.delete(transactionId)
                        .then(data => {
                            if (data == 1) {
                                res.status(200).send({message: 'Cash flow successfully deleted.'});
                            } else {
                                res.status(500).send({error: 'Cash flow deletion failed or not available to delete.'});
                            }
                        });
                });
            }).catch(err => {
                console.error('Error checking linked adjustment before cashflow txn delete:', err);
                res.status(500).send({error: 'Error while deleting the record.'});
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
        // SIGNAL SQLSTATE '45000' from delete_cashflow carries a user-facing message
        const dbErr = error && (error.original || error.parent);
        const message = dbErr && dbErr.sqlState === '45000' ? dbErr.sqlMessage : 'Error while deleting the record.';
        res.status(500).send({error: message});
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
    const username = req.user.User_Name;
    const userId = req.user.Person_id;

    try {
        // Check if user has permission (SuperUser, GOBI-INC, or PowerUser for their own locations)
        const isSuperUser = req.user.Role === 'SuperUser';
        const isGobiInc = username === 'GOBI-INC';
        const isPowerUser = req.user.Role === 'PowerUser';

        if (!isSuperUser && !isGobiInc && !isPowerUser) {
            return res.status(403).json({
                error: 'You do not have access to reopen cashflows.'
            });
        }

        // Validate cashflow belongs to a location this user can access. PowerUser may
        // have multiple assigned locations, so look it up by ID first rather than
        // assuming req.user.location_code (their single home location) is the right one.
        let cashflow;
        if (isPowerUser && !isSuperUser) {
            const found = await cashflowDao.findCashflowById(cashflowId);
            cashflow = (found && security.canAccessLocation(req.user, found.location)) ? found : null;
        } else {
            cashflow = await cashflowDao.findCashflow(req.user.location_code, cashflowId);
        }

        if (!cashflow) {
            return res.status(403).json({
                error: 'Unauthorized: You cannot reopen cashflow records from other locations'
            });
        }

        const locationCode = cashflow.location;

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

function collectCreditAndDebits(result) {
    if (!result) return { data: [], options: [] };
    const creditOrDebits = (result.transactions || []).map((t) => ({
        txn_id: t.transaction_id,
        description: t.description,
        amount: t.amount,
        type: t.type,
        calcFlag: t.calcFlag,
        digitalVendorId: t.digitalVendorId,
        originReceiptId: t.originReceiptId,
        originLedgerId: t.originLedgerId
    }));
    return { data: creditOrDebits, options: result.options || [] };
}


function getCashFlowDetailsPromise(cashflowDetails, req, res, next) {
    const locationCode = req.user.location_code;
    Promise.allSettled([
        cashflowDetails,
        cashflowDao.findCashflowTxnById(locationCode, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[0])),
        cashflowDao.findCashflowTxnById(locationCode, req.query.id, config.cashSaleTypeCodes.get(config.cashSaleTypes[1])),
        cashFlowTxnDenominationPromise(req.query.id),
        getClosingDataForCashflow(req.query.id, locationCode), // Add this new promise
        locationConfig.getLocationConfigValue(locationCode, 'SHOW_CASHFLOW_DENOMINATIONS', 'Y'),
        locationConfig.getLocationConfigValue(locationCode, 'MAX_CASHFLOW_ROWS', config.maxCashFlowRowsCnt),
        adjustmentsDao.getDigitalVendors(locationCode),
        cashflowDao.findCashReceiptCustomers(locationCode),
        cashflowDao.findCashflowEmployees(locationCode)
    ]).then(values => {
        const creditData = collectCreditAndDebits(values[1].value);
        const debitData = collectCreditAndDebits(values[2].value);

        res.render('cash-flow', {
            title: "CashFlow : " + dateFormat(values[0].value.cashflow_date, 'dd-mmm-yyyy'),
            user: req.user,
            config: config,
            cashFlowStatus: values[0].value.status,
            cashflowDate: dateFormat(values[0].value.cashflow_date, 'yyyy-mm-dd'),
            cashFlowDenoms: values[3].value,
            cashflowId: req.query.id,
            cashFlowCredits: creditData.data,
            cashFlowDebits: debitData.data,
            creditOptions: creditData.options,
            debitOptions: debitData.options,
            shiftClosings: values[4].value || [], // Add the closing data
            showCashFlowDenominations: values[5].value === 'Y',
            maxCashFlowRows: Number(values[6].value),
            digitalVendorList: values[7].value || [],
            cashReceiptCustomers: values[8].value || [],
            cashflowEmployees: values[9].value || []
        });
    });
}

function gatherCashflowClosings(fromDate, toDate, user, res, next, messagesOptional) {
    if(fromDate === undefined) fromDate = dateFormat(new Date(), "yyyy-mm-dd");
    if(toDate === undefined) toDate = dateFormat(new Date(), "yyyy-mm-dd");
    Promise.allSettled([cashflowDao.findCashflowClosings(user.location_code, fromDate, toDate),
    cashflowDao.findClosedCashflowTotals(user.location_code, fromDate, toDate),
    cashflowDao.findLatestCashflowClosing(user.location_code)]).then(values => {
        let cashflowValues = [];
        const totalsById = new Map((values[1].value || []).map(t => [t.cashflow_id, t]));
        if(values[0].value) {
            // Newest first — the history list reads top-down from the latest day
            [...values[0].value].reverse().forEach(cashflow => {
                const totals = cashflow.status === 'CLOSED' ? totalsById.get(cashflow.cashflowId) : null;
                cashflowValues.push({
                    cashflowId: cashflow.cashflowId,
                    status: cashflow.status,
                    notes: cashflow.notes,
                    date: dateFormat(cashflow.cashflow_date, 'dd-mmm-yyyy'),
                    isoDate: dateFormat(cashflow.cashflow_date, 'yyyy-mm-dd'),
                    weekday: dateFormat(cashflow.cashflow_date, 'ddd'),
                    inflow: totals ? Number(totals.inflow) : null,
                    outflow: totals ? Number(totals.outflow) : null,
                    balance: totals ? Number(totals.inflow) - Number(totals.outflow) : null
                });
            });
        }
        res.render('cash-flow-home', {
            title: "Day Close", user: user,
            fromDate: fromDate, toDate: toDate,
            cashflowValues: cashflowValues,
            nextDayClose: getNextDayClose(values[2].value),
            generateDate : utils.currentDate(), currentDate: utils.currentDate(),
            messages: messagesOptional});
    });
}

// What the user should do next: continue the open DRAFT, or generate the day
// after the last CLOSED one (generation requires the previous day to be closed).
function getNextDayClose(latestRows) {
    const latest = latestRows && latestRows[0];
    if (!latest) return { mode: 'NEW' };
    if (latest.closing_status !== 'CLOSED') {
        return {
            mode: 'DRAFT', cashflowId: latest.cashflow_id,
            date: dateFormat(new Date(latest.cashflow_date + 'T00:00:00'), 'dd-mmm-yyyy')
        };
    }
    const next = new Date(latest.cashflow_date + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const nextIso = dateFormat(next, 'yyyy-mm-dd');
    if (nextIso > utils.currentDate()) {
        return { mode: 'UP_TO_DATE', lastDate: dateFormat(new Date(latest.cashflow_date + 'T00:00:00'), 'dd-mmm-yyyy') };
    }
    return { mode: 'GENERATE', isoDate: nextIso, date: dateFormat(next, 'dd-mmm-yyyy') };
}

function triggerAndGetCashflowData(cashflowId, req, res, next) {
    cashflowDao.triggerGenerateCashflow(cashflowId).then( () =>
    {
        res.redirect("/cashflow?id=" + cashflowId);
    }).catch((err) => {
        // SIGNAL SQLSTATE '45000' from generate_cashflow carries a user-facing message
        const dbErr = err && (err.original || err.parent);
        const message = dbErr && dbErr.sqlState === '45000' ? dbErr.sqlMessage : "Error while triggering procedure.";
        gatherCashflowClosings(req.body.cashflow_fromDate_hiddenValue,
            req.body.cashflow_toDate_hiddenValue, req.user, res, next,
            {error: message});
    });
}

// A Cash Receipt (Account Head with requires_credit_customer_link='Y') must be
// entered with a customer, via /save-cashflow-receipts, so it lands in the
// customer's ledger. Rejects a free-text line carrying an amount - the gap that
// let PAC's 27-Sep-2026 Rs 1,20,000 payment reach Day Close but not the ledger.
// Salary lines (Account Head with employee_ledger_txn_type) must be entered
// with an employee, via /save-cashflow-employee-entries, so they land in the
// employee ledger - cash in/out of the employee ledger comes only from Day Close.
async function validateNoFreeTextSalaryLines(txnData) {
    const accountHeadIds = [...new Set(txnData.map(r => parseInt(r.account_head_id, 10)).filter(id => !isNaN(id)))];
    const employeeHeads = await cashflowDao.getAccountHeadEmployeeTxnTypes(accountHeadIds);
    if (employeeHeads.size === 0) return null;

    for (const row of txnData) {
        if (employeeHeads.has(parseInt(row.account_head_id, 10)) && (parseFloat(row.amount) || 0) > 0) {
            return '"' + row.type + '" must be entered with an employee.';
        }
    }
    return null;
}

async function validateNoFreeTextCashReceipts(txnData) {
    const accountHeadIds = [...new Set(txnData.map(r => parseInt(r.account_head_id, 10)).filter(id => !isNaN(id)))];
    const customerHeadIds = new Set(await cashflowDao.getAccountHeadsRequiringCustomerLink(accountHeadIds));
    if (customerHeadIds.size === 0) return null;

    for (const row of txnData) {
        if (customerHeadIds.has(parseInt(row.account_head_id, 10)) && (parseFloat(row.amount) || 0) > 0) {
            return '"' + row.type + '" must be entered with a customer.';
        }
    }
    return null;
}

// Server-side backstop for the client-side "required" toggle on the digital-vendor
// picker: rejects the whole save (before anything is persisted) if any row uses an
// Account Head that requires a vendor but has none selected. Guards against the
// client-side validation being bypassed (JS disabled, direct API call, etc.).
async function validateDigitalVendorRows(txnData, locationCode) {
    const allowFlag = await locationConfig.getLocationConfigValue(locationCode, 'ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT', 'N');
    if (allowFlag !== 'Y') return null;

    const accountHeadIds = [...new Set(txnData.map(r => parseInt(r.account_head_id, 10)).filter(id => !isNaN(id)))];
    const requiredIds = new Set(await cashflowDao.getAccountHeadsRequiringVendorLink(accountHeadIds));
    if (requiredIds.size === 0) return null;

    for (const row of txnData) {
        const headId = parseInt(row.account_head_id, 10);
        const amount = parseFloat(row.amount) || 0;
        if (requiredIds.has(headId) && amount > 0 && !row.digital_vendor_id) {
            return `"${row.type}" requires selecting a digital vendor.`;
        }
    }
    return null;
}

// After a batch of cashflow Outflow rows is saved, sync the matching
// digital-vendor debit adjustment for any row that carries a digital_vendor_id
// (or previously did and had it cleared). No-op unless the location has
// ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT='Y'.
async function syncDigitalVendorAdjustments(txnData, savedRows, locationCode) {
    const allowFlag = await locationConfig.getLocationConfigValue(locationCode, 'ALLOW_CASHFLOW_DIGITAL_VENDOR_ADJUSTMENT', 'N');
    if (allowFlag !== 'Y') return;

    const cashflowId = txnData[0] && txnData[0].cashflowId;
    if (!cashflowId) return;

    const [cashflow, digitalVendors] = await Promise.all([
        cashflowDao.findCashflow(locationCode, cashflowId),
        adjustmentsDao.getDigitalVendors(locationCode)
    ]);
    if (!cashflow) return;

    const vendorMap = new Map(digitalVendors.map(v => [String(v.creditlist_id), v.Company_Name]));
    const rows = Array.isArray(savedRows) ? savedRows : [savedRows];

    for (let i = 0; i < txnData.length; i++) {
        const inputRow = txnData[i];
        const savedRow = rows[i];
        const transactionId = (savedRow && savedRow.transaction_id) || inputRow.transaction_id;
        if (!transactionId) continue;

        const digitalVendorId = inputRow.digital_vendor_id ? parseInt(inputRow.digital_vendor_id, 10) : null;
        const amount = parseFloat(inputRow.amount) || 0;
        const vendorName = digitalVendorId ? (vendorMap.get(String(digitalVendorId)) || 'Digital Vendor') : null;

        await adjustmentsDao.syncFromCashflowTxn({
            transactionId,
            locationCode,
            adjustmentDate: cashflow.cashflow_date,
            digitalVendorId,
            vendorName,
            amount,
            username: inputRow.updated_by || inputRow.created_by
        });
    }
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
