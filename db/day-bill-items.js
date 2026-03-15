"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DayBillItem = sequelize.define(config.DAY_BILL_ITEMS_TABLE, {
        item_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        header_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        quantity: {
            type: DataTypes.DECIMAL(12, 3),
            defaultValue: 0
        },
        rate: {
            type: DataTypes.DECIMAL(10, 3),
            defaultValue: 0
        },
        taxable_amount: {
            type: DataTypes.DECIMAL(15, 3),
            defaultValue: 0
        },
        cgst_rate: {
            type: DataTypes.DECIMAL(5, 2),
            defaultValue: 0
        },
        cgst_amount: {
            type: DataTypes.DECIMAL(15, 3),
            defaultValue: 0
        },
        sgst_rate: {
            type: DataTypes.DECIMAL(5, 2),
            defaultValue: 0
        },
        sgst_amount: {
            type: DataTypes.DECIMAL(15, 3),
            defaultValue: 0
        },
        total_amount: {
            type: DataTypes.DECIMAL(15, 3),
            defaultValue: 0
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DayBillItem;
};
