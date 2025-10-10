"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var StockAdjustment = sequelize.define('t_lubes_stock_adjustment', {
        adjustment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        adjustment_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        adjustment_type: {
            type: DataTypes.ENUM('IN', 'OUT'),
            allowNull: false
        },
        qty: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false
        },
        remarks: {
            type: DataTypes.STRING(500),
            allowNull: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return StockAdjustment;
};