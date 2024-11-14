"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Expense = sequelize.define(config.EXPENSE_TABLE, {
        Expense_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        location_code: DataTypes.STRING,
        Expense_name: DataTypes.STRING,
        Expense_default_amt: DataTypes.DECIMAL,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Expense;
};