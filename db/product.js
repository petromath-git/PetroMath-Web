"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Product = sequelize.define(config.PRODUCT_TABLE, {
        product_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        product_name: {
            type: DataTypes.STRING(350),
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        qty: {
            type: DataTypes.DECIMAL(10, 3),
            allowNull: false
        },
        unit: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        price: {
            type: DataTypes.DECIMAL(10, 3),
            allowNull: true
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
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        ledger_name: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        cgst_percent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true
        },
        sgst_percent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true
        },
        sku_name: {
            type: DataTypes.STRING(200),
            allowNull: false
        },
        sku_number: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        hsn_code: {
            type: DataTypes.STRING(50),
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    // Add a virtual field for igst if needed
    Product.prototype.getIgst = function() {
        const cgst = this.cgst_percent || 0;
        const sgst = this.sgst_percent || 0;
        return cgst + sgst;
    };

    return Product;
};