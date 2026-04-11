const CreditReceiptsDao = require("../dao/credit-receipts-dao");
const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const locationConfig = require("../utils/location-config");
const txnController = require("../controllers/txn-common-controller");
const cashFlowController = require("../controllers/cash-flow-controller");
const CreditsDao = require("../dao/credits-dao");
const lookupDao = require('../dao/lookup-dao');

const CREDIT_RECEIPT_BACKDATE_CONFIG = 'CREDIT_RECEIPT_BACKDATE_DAYS';
const DEFAULT_CREDIT_RECEIPT_BACKDATE_DAYS = 1;

function getReceiptDateLimits(backdateDays) {
    const safeBackdateDays = Number.isFinite(backdateDays) && backdateDays >= 0
        ? backdateDays
        : DEFAULT_CREDIT_RECEIPT_BACKDATE_DAYS;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minAllowedDate = new Date(today);
    minAllowedDate.setDate(minAllowedDate.getDate() - safeBackdateDays);

    return {
        backdateDays: safeBackdateDays,
        minAllowedDate,
        today
    };
}

module.exports = {

    // Create credit receipt - one at a time
    saveReceipts: async (req, res) => {
        const txnReceiptDate = req.body.txn_receipt_date_0;
        let locationCode = req.user.location_code;

        console.log('Saving receipt data:', req.body);

        const configuredBackdateDays = Number(await locationConfig.getLocationConfigValue(
            locationCode,
            CREDIT_RECEIPT_BACKDATE_CONFIG,
            DEFAULT_CREDIT_RECEIPT_BACKDATE_DAYS
        ));

        const { minAllowedDate, today } = getReceiptDateLimits(configuredBackdateDays);
        const receiptDate = new Date(txnReceiptDate);
        receiptDate.setHours(0, 0, 0, 0);

        // Validation
            if (
                !txnReceiptDate ||
                Number.isNaN(receiptDate.getTime()) ||
                receiptDate < minAllowedDate ||
                receiptDate > today
            ) {
                req.flash(
                    'error',
                    `Receipt date must be between ${dateFormat(minAllowedDate, 'yyyy-mm-dd')} and ${dateFormat(today, 'yyyy-mm-dd')}.`
                );
                res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                    '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                return;
            }

            if (!req.body.cr_companyId_0 || req.body.cr_companyId_0 === '') {
                req.flash('error', 'Please select a Credit Party.');
                res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                    '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                return;
            }

            // Validate digital vendor if receipt type is digital
            if (req.body.cr_receiptType_0 === 'Digital' && 
                (!req.body.cr_digitalcreditparty_0 || req.body.cr_digitalcreditparty_0 === '')) {
                req.flash('error', 'Please select a Digital Vendor for digital receipts.');
                res.redirect('/creditreceipts?receipts_fromDate=' + req.body.receipts_fromDate_hiddenValue +
                    '&receipts_toDate=' + req.body.receipts_toDate_hiddenValue);
                return;
            }

        
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
            const configuredBackdateDays = Number(await locationConfig.getLocationConfigValue(
                locationCode,
                CREDIT_RECEIPT_BACKDATE_CONFIG,
                DEFAULT_CREDIT_RECEIPT_BACKDATE_DAYS
            ));
            const { backdateDays, minAllowedDate } = getReceiptDateLimits(configuredBackdateDays);

            const [receiptResult, activeCreditResult, suspenseResult,receiptTypes, creditTypes] = await Promise.all([
                CreditReceiptsDao.findCreditReceipts(locationCode, fromDate, toDate),
                txnController.creditCompanyDataPromise(locationCode),  // active credit companies
                txnController.suspenseDataPromise(locationCode),
                lookupDao.getLookupByType('CREDIT_RECEIPT_TYPE', locationCode),
                lookupDao.getCustomerTypes(locationCode)
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
    
                    isEditOrDeleteAllowed = receipt.dataValues.cashflow_date === null && receipt.dataValues.pending_cashflow_id === null;
    
                    

                    const { creditlist_id, Company_Name, type } = creditlist.dataValues;

                    receipts.push({
                        id: receipt.treceipt_id,
                        company_id: creditlist_id,
                        digital_company_id: receipt.digital_creditlist_id,                    
                        company_name: Company_Name,                   
                        receipt_type: receipt.receipt_type,
                        receipt_no: receipt.receipt_no,
                        amount: receipt.amount,
                        notes: receipt.notes,
                        receipt_date: receipt.receipt_date_fmt,
                        showEditOrDelete: receipt.dataValues.cashflow_date === null && receipt.dataValues.pending_cashflow_id === null,
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
       
             

            // For adding new receipts - exclude digital customers
            const activeCreditCompanyValues = activeCreditResult.filter(
                (c) => !c.card_flag || c.card_flag !== 'Y'
            );

            // For displaying existing receipts - include ALL customers (including digital)
            const allActiveCreditCompanyValues = activeCreditResult;  // Don't filter out digital

            const creditCompanyValues = [
                ...allActiveCreditCompanyValues.map(c => ({
                    creditlist_id: c.creditorId,
                    Company_Name: c.creditorName,
                    type: c.type
                })),
                ...suspenseResult.map(c => ({
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

            const inactiveDigitalCreditDetails = inactiveCreditDetails.filter(
                c => c.card_flag === 'Y'
            );  
            const digitalCreditCompanyValues = activeCreditResult.filter(
                (c) => c.card_flag === 'Y'
            );

            const digitalCompanyValues = [
                ...digitalCreditCompanyValues.map(c => ({
                    creditlist_id: c.creditorId,
                    Company_Name: c.creditorName,
                    type: c.type
                })),
                ...inactiveDigitalCreditDetails.map(c => ({
                    creditlist_id: c.creditlist_id,
                    Company_Name: c.Company_Name,
                    type: c.type
                }))
            ];


          
    
            res.render('credit-receipts', {
                        title: 'Credit Receipts',
                        user: req.user,
                        config: config.APP_CONFIGS,
                        receiptTypes: receiptTypes.map(rt => ({ 
                            label: rt.description, 
                            allow_manual_entry: rt.attribute1 === 'Y'
                        })),
                        creditTypes: creditTypes.map(ct => ct.description),
                        hasMultipleCreditTypes: creditTypes.length > 1,
                        defaultCreditType: creditTypes.length > 0 ? creditTypes[0].description : null, 
                        cashReceipts: receipts,
                        creditCompanyValues: creditCompanyValues,
                        digitalCompanyValues: digitalCompanyValues,
                        activeCreditCompanyValues: activeCreditCompanyValues,
                        digActiveCreditCompanyValues: digitalCreditCompanyValues,
                        suspenseValues: suspenseResult,
                        currentDate: utils.currentDate(),
                        minDateForNewReceipts: dateFormat(minAllowedDate, "yyyy-mm-dd"),
                        receiptBackdateDays: backdateDays,
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
            digital_creditlist_id: req.body.digital_creditlist_id || null,
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
        if (!req.query.id) {
            return res.status(400).send({ error: 'Receipt deletion failed or not available to delete.' });
        }
        CreditReceiptsDao.findById(req.query.id)
            .then(receipt => {
                if (!receipt) {
                    return res.status(404).send({ error: 'Receipt not found.' });
                }
                if (receipt.cashflow_date !== null || receipt.pending_cashflow_id !== null) {
                    return res.status(400).send({ error: 'Receipt is part of a cashflow and cannot be deleted.' });
                }
                return CreditReceiptsDao.delete(req.query.id);
            })
            .then(data => {
                if (data === undefined) return; // already responded above
                if (data == 1) {
                    res.status(200).send({ message: 'Receipt successfully deleted.' });
                } else {
                    res.status(500).send({ error: 'Receipt deletion failed or not available to delete.' });
                }
            })
            .catch(next);
    }
}
