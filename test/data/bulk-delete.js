const db = require("../../db/db-connection");
const { Op } = require("sequelize");
const config = require("../../config/app-config");
const locationDb = db.location;
const person = db.person;
const product = db.product;
const pump = db.pump;
const credit = db.credit;
const expense = db.expense;
const txn_cashsales = db.txn_cashsales;
const txn_closing = db.txn_closing;
const txn_reading = db.txn_reading;
const txn_2t_oil = db.txn_2t_oil;
const txn_credits = db.txn_credits;
const txn_denom = db.txn_denom;
const txn_expense = db.txn_expense;
const creditReceipts = db.credit_receipts;

module.exports = {
    deleteAllMasterRecords: () => {
        locationDb.destroy({ where: { location_code: {[Op.ne]: null }}});
        person.destroy({ where: { Person_Name: {[Op.ne]: 'admin' }}});
        product.destroy({ where: { location_code: {[Op.ne]: null }}});
        pump.destroy({ where: { location_code: {[Op.ne]: null }}});
        credit.destroy({ where: { location_code: {[Op.ne]: null }}});
        expense.destroy({ where: { location_code: {[Op.ne]: null }}});
    },
    deleteAllTxnRecords: () => {
        txn_2t_oil.destroy({ where: { oil_id: {[Op.ne]: 0 }}});
        txn_cashsales.destroy({ where: { cashsales_id: {[Op.ne]: 0 }}});
        txn_closing.destroy({ where: { location_code: {[Op.ne]: null }}});
        txn_reading.destroy({ where: { reading_id: {[Op.ne]: 0 }}});
        txn_credits.destroy({ where: { tcredit_id: {[Op.ne]: 0 }}});
        txn_denom.destroy({ where: { denom_id: {[Op.ne]: 0 }}});
        txn_expense.destroy({ where: { texpense_id: {[Op.ne]: 0 }}});
        creditReceipts.destroy({ where: { treceipt_id: {[Op.ne]: 0 }}});
    },
}
