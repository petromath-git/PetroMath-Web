"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Product = sequelize.define(config.PRODUCT_TABLE, {
        product_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        product_name: DataTypes.STRING,
        location_code: DataTypes.STRING,
        qty: DataTypes.DECIMAL,
        unit: DataTypes.STRING,
        price: DataTypes.DECIMAL,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
        ledger_name:DataTypes.STRING,
        cgst_percent:DataTypes.DECIMAL,
        sgst_percent:DataTypes.DECIMAL
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Product;
};