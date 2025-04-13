const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnBankView = sequelize.define(config.TXN_BANK_TRANS_VIEW, {
        t_bank_id: {
            field: 't_bank_id',
            type: DataTypes.INTEGER,
        },
        trans_date: {
            field: 'trans_date',
            type: DataTypes.DATE
        },
        transaction_type: {
            field: 'transaction_type',
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
        closing_bal: {
            field: 'closing_bal',
            type: DataTypes.DECIMAL
        },
        bank_id: {
            field: 'bank_id',
            type: DataTypes.INTEGER
        },
        bank_name: {
            field:'bank_name',
            type: DataTypes.STRING,
        },
        account_number: {
            field: 'account_number',
            type: DataTypes.STRING
        },
        account_nickname: {
            field: 'account_nickname',
            type: DataTypes.STRING
        },

        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },

        closed_flag: {
            field: 'closed_flag',
            type: DataTypes.STRING
        },
        accounting_type: {
            field: 'accounting_type',
            type: DataTypes.STRING
        },         
         ledger_name: {
            field: 'ledger_name',
            type: DataTypes.STRING
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    TxnBankView.removeAttribute('id');
    return TxnBankView;
};