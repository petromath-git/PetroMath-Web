"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var PlatformInvoice = sequelize.define(config.PLATFORM_INVOICE_TABLE, {
        invoice_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        invoice_number: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        period_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        period_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        gross_amount: {
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        discount_amount: {
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        net_amount: {
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        due_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'),
            defaultValue: 'UNPAID'
        },
        generated_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
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

    return PlatformInvoice;
};
