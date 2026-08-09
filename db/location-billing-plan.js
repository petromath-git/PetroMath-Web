"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var LocationBillingPlan = sequelize.define(config.LOCATION_BILLING_PLAN_TABLE, {
        billing_plan_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        plan_duration_months: {
            // 1 = monthly, 12 = annual; extensible to 24/36 later
            type: DataTypes.INTEGER,
            defaultValue: 1
        },
        plan_rate: {
            // Price for the whole duration, not per-month
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        discount_type: {
            type: DataTypes.ENUM('NONE', 'PERCENT', 'FIXED'),
            defaultValue: 'NONE'
        },
        discount_value: {
            type: DataTypes.DECIMAL(12, 2),
            defaultValue: 0
        },
        trial_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
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

    return LocationBillingPlan;
};
