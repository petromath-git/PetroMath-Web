"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    return sequelize.define(config.DENSITY_TABLE, {
        density_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        temparture: DataTypes.DECIMAL,
        density: DataTypes.DECIMAL,
        density_at_15: DataTypes.DECIMAL,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });
};
