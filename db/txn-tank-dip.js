"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define(config.TXN_TANK_DIP, {
        tdip_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tank_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        dip_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        dip_time: {
            type: DataTypes.TIME,
            allowNull: false
        },
        dip_reading: {
            type: DataTypes.DECIMAL(10,2),
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 't_tank_dip',
        timestamps: false,
        freezeTableName: true
    });
};