"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnCashFlow = sequelize.define(config.TXN_CASHFLOW_TABLE, {
        transaction_id: {
            field: 'transaction_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        cashflowId: {
            field: 'cashflow_id',
            type: DataTypes.INTEGER
        },
        description: {
            field: 'description',
            type: DataTypes.STRING
        },
        type: {
            field: 'type',
            type: DataTypes.STRING
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        },
        calcFlag: {
            field: 'calc_flag',
            type: DataTypes.STRING
        },
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return TxnCashFlow;
}