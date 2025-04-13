const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var BankTxns = sequelize.define(config.TXN_BANK_ACCOUNTS, {
        t_bank_id: {
            field: 't_bank_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        trans_date: {
            field: 'trans_date',
            type: DataTypes.DATE
        },
        bank_id: {
            field: 'bank_id',
            type: DataTypes.INTEGER
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },
        remarks: {
            field: 'remarks',
            type: DataTypes.STRING
        },
        credit_amount: {
            field: 'credit_amount',
            type: DataTypes.DECIMAL
        },
        debit_amount: {
            field: 'debit_amount',
            type: DataTypes.DECIMAL
        },
        created_by: {
            field: 'created_by',
            type: DataTypes.STRING
        },
        updated_by: {
            field: 'updated_by',
            type: DataTypes.STRING
        },
        creation_date: {
            field: 'creation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        updation_date: {
            field: 'updation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        transaction_type: {
            field: 'transaction_type',
            type: DataTypes.INTEGER
        },
        closed_flag: {
            field: 'closed_flag',
            type: DataTypes.STRING,
            defaultValue:'N'
        },
        accounting_type: {
            field: 'accounting_type',
            type: DataTypes.STRING
        },
        ledger_name: {
            field: 'ledger_name',
            type: DataTypes.STRING
        },
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return BankTxns;
};