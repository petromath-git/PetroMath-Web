"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Credit = sequelize.define(config.CREDIT_TABLE, {
        creditlist_id: {
            type: DataTypes.INTEGER,
            primaryKey: true
        },
        location_code: DataTypes.STRING,
        Company_Name: DataTypes.STRING,
        type: DataTypes.STRING,
        address: DataTypes.STRING,
        phoneno: DataTypes.STRING,
        gst: DataTypes.STRING,
        short_name: DataTypes.STRING,
        Opening_Balance: DataTypes.DECIMAL,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
        effective_start_date: DataTypes.DATE,
        effective_end_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Credit;
};
