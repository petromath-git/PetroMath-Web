"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Account = sequelize.define(config.BANK_TABLE, {
        bank_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        bank_name: {
            type: DataTypes.STRING(150),
            allowNull: true
        },
        bank_branch: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        account_number: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        ifsc_code: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        type: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        cc_limit: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        ledger_name: {
            type: DataTypes.STRING(250),
            allowNull: true
        },
        account_nickname: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        location_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        internal_flag: {
            type: DataTypes.ENUM('Y', 'N'),
            allowNull: true,
            defaultValue: 'N'
        },
        is_oil_company: {
            type: DataTypes.ENUM('Y', 'N'),
            allowNull: true,
            defaultValue: 'N'
        },
        active_flag: {
            type: DataTypes.ENUM('Y', 'N'),
            allowNull: true,
            defaultValue: 'Y'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });
    
    return Account;
};