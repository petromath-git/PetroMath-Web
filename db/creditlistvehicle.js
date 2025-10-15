"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var CreditListVehicle = sequelize.define(config.CREDIT_LIST_VEHICLE_TABLE, {
        vehicle_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        creditlist_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        vehicle_number: {
            type: DataTypes.STRING,
            allowNull: false
        },
        vehicle_type: {
            type: DataTypes.STRING,
            allowNull: true
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        updated_by: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return CreditListVehicle;
};