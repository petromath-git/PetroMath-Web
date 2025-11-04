"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var PersonLocation = sequelize.define(config.PERSON_LOCATION_TABLE, {
        personloc_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        person_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(10),
            allowNull: false
        },
        role: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        created_by: {
            type: DataTypes.STRING(50)
        },
        updated_by: {
            type: DataTypes.STRING(50)
        },
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return PersonLocation;
};