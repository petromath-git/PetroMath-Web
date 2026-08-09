"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var LocationDistributor = sequelize.define(config.LOCATION_DISTRIBUTOR_TABLE, {
        assignment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        distributor_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        commission_percent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return LocationDistributor;
};
