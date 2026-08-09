"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DistributorCommission = sequelize.define(config.DISTRIBUTOR_COMMISSION_TABLE, {
        commission_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        payment_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        distributor_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        payment_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        commission_percent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false
        },
        commission_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('PENDING', 'PAID'),
            defaultValue: 'PENDING'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DistributorCommission;
};
