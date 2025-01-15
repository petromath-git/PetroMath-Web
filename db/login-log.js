"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var LoginLog = sequelize.define(config.LOGIN_LOG_TABLE, {
        log_id: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true
        },
        Person_id: {
            type: DataTypes.INTEGER,
            allowNull: true  // Changed to allow null for non-existent users
        },
        login_timestamp: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        ip_address: {
            type: DataTypes.STRING(45)
        },
        user_agent: {
            type: DataTypes.TEXT
        },
        device_type: {
            type: DataTypes.STRING(50)
        },
        browser: {
            type: DataTypes.STRING(50)
        },
        operating_system: {
            type: DataTypes.STRING(50)
        },
        device_version: {
            type: DataTypes.STRING(50)
        },
        attempted_username: {  // Added to track attempted username
            type: DataTypes.STRING(100)
        },
        login_status: {
            type: DataTypes.ENUM('success', 'failed'),
            allowNull: false
        },
        failure_reason: {
            type: DataTypes.STRING(255)
        },
        location_code: {
            type: DataTypes.STRING(45)
        },
        created_by: {
            type: DataTypes.STRING
        },
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false
    });

    return LoginLog;
};