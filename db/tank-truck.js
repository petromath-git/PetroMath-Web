"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var truck = sequelize.define(config.TANK_TRUCK_TABLE, {
        truck_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        truck_number: DataTypes.STRING,
        model: DataTypes.STRING,
        year: DataTypes.INTEGER,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return truck;
};