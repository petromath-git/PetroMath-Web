"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var PlatformInvoiceItem = sequelize.define(config.PLATFORM_INVOICE_ITEMS_TABLE, {
        item_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        invoice_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        description: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 1
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return PlatformInvoiceItem;
};
