"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var CashFlowClosing = sequelize.define(config.CASHFLOW_CLOSING_TABLE, {
        cashflowId: {
            autoIncrement: true,
            field: 'cashflow_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
        },
        location: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        status: {
            field: 'closing_status',
            type: DataTypes.STRING
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
        },
        cashflow_date: {
            field: 'cashflow_date',
            type: DataTypes.DATE
        },
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return CashFlowClosing;
}