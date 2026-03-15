"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DayBill = sequelize.define(config.DAY_BILL_TABLE, {
        day_bill_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        bill_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        cashflow_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('ACTIVE', 'CANCELLED'),
            defaultValue: 'ACTIVE'
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

    return DayBill;
};
