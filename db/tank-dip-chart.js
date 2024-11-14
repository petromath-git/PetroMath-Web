"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define(config.TANK_DIP_CHART_TABLE, {
        dip_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        dip_chart_name: DataTypes.STRING,
        dip_reading: DataTypes.INTEGER,
        volume: DataTypes.DECIMAL,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });
};
