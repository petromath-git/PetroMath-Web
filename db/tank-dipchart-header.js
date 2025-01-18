"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define("m_tank_dipchart_header", {
        dipchartid: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        chart_name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        capacity_liters: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        int_diameter_cm: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        int_length_cm: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        p1_cm: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        p2_cm: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        deadwood_liters: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
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
        tableName: 'm_tank_dipchart_header',
        timestamps: false,
        freezeTableName: true
    });
};