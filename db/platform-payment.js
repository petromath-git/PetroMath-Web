"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var PlatformPayment = sequelize.define(config.PLATFORM_PAYMENT_TABLE, {
        payment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        payment_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        payment_mode: {
            type: DataTypes.ENUM('MANUAL_CASH', 'MANUAL_BANK', 'MANUAL_UPI', 'MANUAL_CHEQUE', 'RAZORPAY', 'OTHER'),
            defaultValue: 'MANUAL_CASH'
        },
        reference_number: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        gateway_txn_id: {
            // Unused until a payment gateway is integrated
            type: DataTypes.STRING(150),
            allowNull: true
        },
        gateway_payload: {
            type: DataTypes.JSON,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('RECORDED', 'CONFIRMED', 'FAILED', 'REFUNDED'),
            defaultValue: 'RECORDED'
        },
        remarks: {
            type: DataTypes.STRING(255),
            allowNull: true
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

    return PlatformPayment;
};
