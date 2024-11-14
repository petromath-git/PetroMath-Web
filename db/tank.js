"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Tank = sequelize.define(config.TANK_TABLE, {
        tank_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        tank_code: DataTypes.STRING,
        product_code: DataTypes.STRING,
        location_code: DataTypes.STRING,
        tank_orig_capacity: DataTypes.DECIMAL,
        tank_current_stock: DataTypes.DECIMAL,
        effective_start_date: DataTypes.DATE,
        effective_end_date: DataTypes.DATE,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
        dead_stock: DataTypes.DECIMAL
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Tank;
};