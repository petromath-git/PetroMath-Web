"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var lookup = sequelize.define(config.LOOKUP_TABLE, {
        lookup_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        lookup_type: DataTypes.STRING,
        description: DataTypes.STRING,
        tag: DataTypes.STRING,
        start_date_active: DataTypes.DATE,
        end_date_active: DataTypes.DATE,
        attribute1: DataTypes.STRING,
        attribute2: DataTypes.STRING,
        attribute3: DataTypes.STRING,
        attribute4: DataTypes.STRING,
        attribute5: DataTypes.STRING,
        location_code: DataTypes.STRING,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return lookup;
};
