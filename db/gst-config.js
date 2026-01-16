"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var GstConfig = sequelize.define('m_gst_config', {
        gst_config_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'Location code from m_location'
        },
        gstin: {
            type: DataTypes.STRING(15),
            allowNull: false,
            comment: 'GSTIN for this location'
        },
        api_provider: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'MASTERINDIA',
            comment: 'GST API provider name'
        },
        api_key: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: 'API key/username for authentication (encrypted)'
        },
        api_secret: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: 'API secret/password for authentication (encrypted)'
        },
        api_base_url: {
            type: DataTypes.STRING(200),
            allowNull: true,
            comment: 'Base URL for API endpoints'
        },
        is_active: {
            type: DataTypes.TINYINT(1),
            allowNull: false,
            defaultValue: 1,
            comment: '1=Active, 0=Inactive'
        },
        gst_username: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'GST Portal username for this GSTIN'
        },
        environment: {
            type: DataTypes.ENUM('SANDBOX', 'PRODUCTION'),
            allowNull: false,
            defaultValue: 'SANDBOX',
            comment: 'API environment'
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
        freezeTableName: true,
        indexes: [
            {
                unique: true,
                fields: ['location_code']
            },
            {
                unique: true,
                fields: ['gstin']
            }
        ]
    });

    return GstConfig;
};