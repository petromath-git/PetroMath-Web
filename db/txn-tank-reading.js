"use strict";
const config = require("../config/app-config");



        module.exports = function(sequelize, DataTypes) {
            return sequelize.define(config.TXN_TANK_READING, {
                ttankreading_id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                    autoIncrement: true
                },
                tdip_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                pump_id: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                reading: {
                    type: DataTypes.DECIMAL(20,3),
                    allowNull: false
                },
                created_by: DataTypes.STRING(45),
                updated_by: DataTypes.STRING(45),
                updation_date: {
                    type: DataTypes.DATE,
                    defaultValue: DataTypes.NOW
                },
                creation_date: DataTypes.DATE
            }, {
                timestamps: false,
                freezeTableName: true
            });
        };