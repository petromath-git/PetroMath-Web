"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Distributor = sequelize.define(config.DISTRIBUTOR_TABLE, {
        distributor_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        distributor_name: {
            type: DataTypes.STRING(150),
            allowNull: false
        },
        phone: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        remarks: {
            type: DataTypes.STRING(255),
            allowNull: true
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

    return Distributor;
};
