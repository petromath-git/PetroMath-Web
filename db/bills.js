"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Bills = sequelize.define("t_bills", {
        bill_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        bill_no: {
            type: DataTypes.STRING,
            allowNull: false
        },
        bill_type: {
            type: DataTypes.ENUM('CASH', 'CREDIT'),
            allowNull: false
        },
        closing_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        bill_status: {
            type: DataTypes.ENUM('DRAFT', 'ACTIVE', 'CANCELLED'),
            defaultValue: 'DRAFT',
            allowNull: false
        },
        print_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        total_amount: {
            type: DataTypes.DECIMAL(15,3),
            defaultValue: 0
        },
        cancelled_reason: DataTypes.TEXT,
        cancelled_by: DataTypes.STRING(45),
        cancelled_date: DataTypes.DATE,
        created_by: DataTypes.STRING(45),
        updated_by: DataTypes.STRING(45),
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: sequelize.literal('CURRENT_TIMESTAMP')
        },
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Bills;
};