const db = require("../db/db-connection");
const moment = require('moment');
const Sequelize = require("sequelize");
const { Op } = require("sequelize");

const BankAcct = db.m_bank;
const TxnAccount=db.txn_bank_account;
const Location=db.location;
const Lookup = db.lookup;
const TxnBankView = db.txn_bank_transaction_view;

module.exports = {
    getAccountno: (locationCode) => {
        return BankAcct.findAll({
            attributes: ['bank_id','account_number','account_nickname'],  
                include: [
                    {
                        model: Location,
                        attributes:['location_id'],
                        where: {location_code: locationCode},
                        required: true,
                    },
                ],
        });
    },

    getLocationId: (locationCode) => {
        return Location.findOne({
            attributes: ['location_id'],
            where: {'location_code': locationCode}
        });
    },

    getTransactionType:() =>{
        return Lookup.findAll({
            attributes:['lookup_id','description','attribute1'],
            where: {'lookup_type': 'Bank_Transaction_Type'}
        });
    },

    getAccountingType:() =>{
        return Lookup.findAll({
            attributes:['attribute1'],
            where: {'lookup_type': 'Bank_Transaction_Type'}
        });
    },

    getAccountingTypeforId:(lookup_id) => {
        return Lookup.findOne({
            attributes: ['attribute1'],
            where: {'lookup_id': lookup_id}
            //where: {'lookup_type': 'Bank_Transaction_Type'}
        });
    },

    create: (txnBankData) => {
        return TxnAccount.create(txnBankData)
    },

    delete: (t_bank_Id) => {
        const deleteStatus = TxnAccount.destroy({ where: { t_bank_id: t_bank_Id } });
        return deleteStatus;
    },

    getTransactionByDate: 
    (locationCode, QueryFromDate, QueryToDate,bankid) => {
        if(!bankid || bankid == 0) {
            return TxnBankView.findAll({
                where: { [Op.and]: [
 
                    {
                    trans_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("trans_date"), '%Y-%m-%d'), ">=",  QueryFromDate)
                    },
                    {
                    trans_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("trans_date"), '%Y-%m-%d'), "<=",  QueryToDate)
                    },
                ] },  
            order: [Sequelize.literal('t_bank_id')],
            include: [
                {        
                    model: Location,
                    attributes:['location_id'],
                    where: {location_code: locationCode},
                    required: true,
                        
                }]     
            });
        }
        else {
            return TxnBankView.findAll({
            where: { [Op.and]: [

                {
                    bank_id: bankid},
                {
                trans_date: Sequelize.where(
                    Sequelize.fn("date_format", Sequelize.col("trans_date"), '%Y-%m-%d'), ">=",  QueryFromDate)
                },
                {
                trans_date: Sequelize.where(
                    Sequelize.fn("date_format", Sequelize.col("trans_date"), '%Y-%m-%d'), "<=",  QueryToDate)
                },
            ] },  
        order: [Sequelize.literal('t_bank_id')],
    
        });
        } 
    },
}