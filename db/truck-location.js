"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var truckloc = sequelize.define(config.TRUCK_LOCATION_TABLE, {
        truck_loc_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        truck_id: DataTypes.INTEGER,
        own_location_flag: DataTypes.STRING,
        location_id: DataTypes.INTEGER,
        eff_start_date: DataTypes.DATE,
        eff_end_date: DataTypes.DATE,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return truckloc;
};