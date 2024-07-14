"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Account = sequelize.define(config.BANK_TABLE, {
        bank_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        bank_name: DataTypes.STRING,
        bank_branch: DataTypes.STRING,
        account_number: DataTypes.STRING,
        ifsc_code: DataTypes.STRING,
        location_id: DataTypes.INTEGER,
        type: DataTypes.STRING,
        cc_limit: DataTypes.INTEGER,
        ledger_name: DataTypes.STRING,
        account_nickname: DataTypes.STRING,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return Account;
};