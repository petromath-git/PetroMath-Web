"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Pump = sequelize.define(config.PUMP_TABLE, {
        pump_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        pump_code: DataTypes.STRING,
        pump_make: DataTypes.STRING,
        product_code: DataTypes.STRING,
        opening_reading: DataTypes.DECIMAL,
        location_code: DataTypes.STRING,
        current_stamping_date: DataTypes.DATE,
        Stamping_due: DataTypes.DATE,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
		effective_end_date: DataTypes.DATE,
		effective_start_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Pump;
};