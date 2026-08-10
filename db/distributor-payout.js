"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DistributorPayout = sequelize.define(config.DISTRIBUTOR_PAYOUT_TABLE, {
        payout_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        distributor_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        payout_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        payment_mode: {
            type: DataTypes.ENUM('MANUAL_CASH', 'MANUAL_BANK', 'MANUAL_UPI', 'MANUAL_CHEQUE', 'OTHER'),
            defaultValue: 'MANUAL_CASH'
        },
        reference_number: {
            type: DataTypes.STRING(100),
            allowNull: true
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

    return DistributorPayout;
};
