"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Person = sequelize.define(config.PERSON_TABLE, {
        Person_id: {
            type: DataTypes.STRING,
            primaryKey: true
        },
        Person_Name: DataTypes.STRING,
        User_Name: DataTypes.STRING,
        Password: DataTypes.STRING,
        Role: DataTypes.STRING,
        location_code: DataTypes.STRING,
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
		effective_start_date: DataTypes.DATE,
		effective_end_date: DataTypes.DATE
    }, {
        timestamps: false
    });

    return Person;
};