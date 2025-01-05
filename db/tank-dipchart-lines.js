"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define("m_tank_dipchart_lines", {
        dipchartlineid: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        dipchartid: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        dip_cm: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        volume_liters: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        diff_liters_mm: {
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
        tableName: 'm_tank_dipchart_lines',
        timestamps: false,
        freezeTableName: true
    });
};