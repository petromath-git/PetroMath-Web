"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define(config.PUMP_TANK_TABLE, {
        pump_tank_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        pump_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        tank_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        effective_start_date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        created_by: DataTypes.STRING(45),
        updated_by: DataTypes.STRING(45),
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        creation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });
};