const CreditReceiptsDao = require("../dao/credit-receipts-dao");
const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const txnController = require("../controllers/txn-common-controller");
const cashFlowController = require("../controllers/cash-flow-controller");

module.exports = {

    // Create credit receipt - one at a time
    saveReceipts: (req, res) => {
        const txnReceiptDate = req.body.txn_receipt_date_0;
        let locationCode = req.user.location_code;

        cashFlowController.checkCashFlowClosingStatus(locationCode, txnReceiptDate)
            .then(cashFlowClosing => {
                if (cashFlowClosing.length == 1 && cashFlowClosing[0].status === 'CLOSED') {
                    req.flash('error', "Receipt Cannot be Saved. Cash flow for " + dateFormat(txnReceiptDate, 'dd-mm-yyyy') + " is already Closed.");
                    res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                        '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                } else {
                    CreditReceiptsDao.create(dbMapping.newReceipt(req))
                        .then(data => {
                            console.log('CreditReceiptsDao.create result:', data);
                            if (data) {
                                req.flash('success', 'Saved receipt data successfully.');
                                res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                                    '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                            } else {
                                req.flash('error', 'Saved receipt data failed.');
                                res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                                    '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                            }
                        })
                }
            })
    },

    // Get credit receipts - from and to date provided
    getReceipts: (req, res) => {
        let locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
        if (req.query.receipts_fromDate) {
            fromDate = req.query.receipts_fromDate;
        }
        if (req.query.receipts_toDate) {
            toDate = req.query.receipts_toDate;
        }
        let receipts = [];
        Promise.allSettled([CreditReceiptsDao.findCreditReceipts(locationCode, fromDate, toDate),
        txnController.creditCompanyDataPromise(locationCode),
        txnController.suspenseDataPromise(locationCode)])
            .then(values => {
                values[0].value.forEach((receipt) => {
                    let creditlist = receipt.m_credit_list;
                    let isEditOrDeleteAllowed = false;
                    if (creditlist) {
                        // isEditOrDeleteAllowed = utils.noOfDaysDifference(receipt.receipt_date, utils.currentDate())
                        //     < config.APP_CONFIGS.receiptEditOrDeleteAllowedDays ? true : false;

                        isEditOrDeleteAllowed = receipt.dataValues.cashflow_date === null ? true : false;
                        receipts.push({
                            id: receipt.treceipt_id,
                            company_name: creditlist.Company_Name,
                            receipt_type: receipt.receipt_type,
                            receipt_no: receipt.receipt_no, amount: receipt.amount, notes: receipt.notes,
                            receipt_date: receipt.receipt_date_fmt,
                            showEditOrDelete: isEditOrDeleteAllowed,
                            creditType: creditlist.type
                        });
                    } else {
                        console.warn("Server app error: Looks like data is corrupted, debug more.")
                    }
                });
                res.render('credit-receipts', {
                    title: 'Credit Receipts', user: req.user,
                    config: config.APP_CONFIGS,
                    cashReceipts: receipts,
                    creditCompanyValues: values[1].value,
                    suspenseValues: values[2].value,
                    currentDate: utils.currentDate(),
                    minDateForNewReceipts: utils.restrictToPastDate(config.APP_CONFIGS.receiptEditOrDeleteAllowedDays),
                    fromDate: fromDate,
                    toDate: toDate
                });
            });
    },

    // Update credit receipt
    updateReceipts: (req, res) => {
        CreditReceiptsDao.update({
            treceipt_id: req.params.id,
            receipt_type: req.body.receipt_type,
            receipt_no: req.body.receipt_no,
            amount: req.body.amount,
            notes: req.body.notes
        }).then(data => {
            if (data == 1 || data == 0) {
                res.status(200).send({ message: 'Saved receipt data successfully.' });
            } else {
                res.status(500).send({ error: 'Saved receipt data failed.' });
            }
        });
    },

    // Delete credit receipt
    deleteReceipts: (req, res, next) => {
        if (req.query.id) {
            CreditReceiptsDao.delete(req.query.id)
                .then(data => {
                    if (data == 1) {
                        res.status(200).send({ message: 'Receipt successfully deleted.' });
                    } else {
                        res.status(500).send({ error: 'Receipt deletion failed or not available to delete.' });
                    }
                });
        } else {
            res.status(500).send({ error: 'Receipt deletion failed or not available to delete.' });
        }
    }
}
