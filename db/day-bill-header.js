"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DayBillHeader = sequelize.define(config.DAY_BILL_HEADER_TABLE, {
        header_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        day_bill_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        bill_type: {
            type: DataTypes.ENUM('CASH', 'DIGITAL'),
            allowNull: false
        },
        vendor_id: {
            // NULL for CASH bills; FK to m_credit_list.creditlist_id for DIGITAL
            type: DataTypes.INTEGER,
            allowNull: true
        },
        bill_number: {
            // User-entered from physical bill book; preserved on recalculate
            type: DataTypes.STRING(100),
            allowNull: true
        },
        total_amount: {
            type: DataTypes.DECIMAL(15, 3),
            defaultValue: 0
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DayBillHeader;
};
