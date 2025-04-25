const CreditReceiptsDao = require("../dao/credit-receipts-dao");
const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const txnController = require("../controllers/txn-common-controller");
const cashFlowController = require("../controllers/cash-flow-controller");
const CreditsDao = require("../dao/credits-dao");

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
    getReceipts: async (req, res) => {
        const locationCode = req.user.location_code;
        let fromDate = dateFormat(new Date(), "yyyy-mm-dd");
        let toDate = dateFormat(new Date(), "yyyy-mm-dd");
    
        if (req.query.receipts_fromDate) {
            fromDate = req.query.receipts_fromDate;
        }
        if (req.query.receipts_toDate) {
            toDate = req.query.receipts_toDate;
        }
    
        try {
            const [receiptResult, activeCreditResult, suspenseResult] = await Promise.all([
                CreditReceiptsDao.findCreditReceipts(locationCode, fromDate, toDate),
                txnController.creditCompanyDataPromise(locationCode),  // active credit companies
                txnController.suspenseDataPromise(locationCode)
            ]);

            
            
    
            const receipts = [];
            const inactiveCreditIds = new Set();
    
            receiptResult.forEach((receipt) => {
                const creditlist = receipt.m_credit_list;
                let isEditOrDeleteAllowed = false;
    
                if (creditlist) {
                    // If the effective_end_date is in the past, mark as inactive

                    const endDate = creditlist.effective_end_date;
                    

                    if (endDate && new Date(endDate) < new Date()) {
                        inactiveCreditIds.add(creditlist.creditlist_id);
                    }                   
    
                    isEditOrDeleteAllowed = receipt.dataValues.cashflow_date === null;
    
                    

                    const { creditlist_id, Company_Name, type } = creditlist.dataValues;

                    receipts.push({
                        id: receipt.treceipt_id,
                        company_id: creditlist_id,                    
                        company_name: Company_Name,                   
                        receipt_type: receipt.receipt_type,
                        receipt_no: receipt.receipt_no,
                        amount: receipt.amount,
                        notes: receipt.notes,
                        receipt_date: receipt.receipt_date_fmt,
                        showEditOrDelete: receipt.dataValues.cashflow_date === null,
                        creditType: type
                    });
                } else {
                    console.warn("Server app error: Missing or corrupted credit list");
                }
            });
    
            // Fetch inactive credit party details only if needed
            let inactiveCreditDetails = [];
            if (inactiveCreditIds.size > 0) {
                inactiveCreditDetails = await CreditsDao.findCreditDetails([...inactiveCreditIds]);
            }
    
            // Final datasets for view rendering
            const activeCreditCompanyValues = activeCreditResult;
            const activeSuspenseValues = suspenseResult;           // Already plain
            const creditCompanyValues = [
                ...activeCreditCompanyValues.map(c => ({
                    creditlist_id: c.creditorId,         // normalize to standard field
                    Company_Name: c.creditorName,
                    type: c.type
                })),
                ...activeSuspenseValues.map(c => ({
                    creditlist_id: c.creditorId,
                    Company_Name: c.creditorName,
                    type: c.type
                })),
                ...inactiveCreditDetails.map(c => ({
                    creditlist_id: c.creditlist_id,
                    Company_Name: c.Company_Name,
                    type: c.type
                }))
            ];


          
    
            res.render('credit-receipts', {
                title: 'Credit Receipts',
                user: req.user,
                config: config.APP_CONFIGS,
                cashReceipts: receipts,
                creditCompanyValues: creditCompanyValues,              // main table: show active + inactive
                activeCreditCompanyValues: activeCreditCompanyValues,  // mixin (add new): only active
                suspenseValues: suspenseResult,
                currentDate: utils.currentDate(),
                minDateForNewReceipts: utils.restrictToPastDate(config.APP_CONFIGS.receiptEditOrDeleteAllowedDays),
                fromDate: fromDate,
                toDate: toDate
            });
    
        } catch (err) {
            console.error("Error fetching credit receipts:", err);
            res.status(500).send("Internal Server Error");
        }
    },
    

    // Update credit receipt
    updateReceipts: (req, res) => {
        CreditReceiptsDao.update({
            treceipt_id: req.params.id,
            receipt_no: req.body.receipt_no,
            receipt_type: req.body.receipt_type,
            credit_type: req.body.credit_type,
            creditlist_id: req.body.company_id,
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
