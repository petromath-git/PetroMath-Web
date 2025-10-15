"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var location = sequelize.define(config.LOCATION_TABLE, {
        location_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        location_name: {
            type: DataTypes.STRING(300),
            allowNull: false
        },
        address: {
            type: DataTypes.STRING(1000),
            allowNull: false
        },
        company_name: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        gst_number: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        phone: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        start_date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '9999-12-31'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return location;
};