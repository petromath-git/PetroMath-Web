"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var location = sequelize.define(config.LOCATION_TABLE, {
        location_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        location_code: DataTypes.STRING,
        location_name: DataTypes.STRING,
        address: DataTypes.STRING,
        start_date: DataTypes.STRING,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return location;
};
