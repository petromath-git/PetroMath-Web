"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var GstFilingLog = sequelize.define('t_gst_filing_log', {
        filing_log_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        return_data_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'FK to t_gst_return_data'
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        gstin: {
            type: DataTypes.STRING(15),
            allowNull: false
        },
        return_type: {
            type: DataTypes.STRING(20),
            allowNull: true
        },
        return_period: {
            type: DataTypes.STRING(10),
            allowNull: true
        },
        action_type: {
            type: DataTypes.ENUM('AUTHENTICATE', 'GENERATE', 'VALIDATE', 'FILE', 'STATUS_CHECK', 'DOWNLOAD'),
            allowNull: false,
            comment: 'Type of API action performed'
        },
        api_endpoint: {
            type: DataTypes.STRING(200),
            allowNull: true,
            comment: 'API endpoint called'
        },
        request_payload: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'Request sent to API'
        },
        response_payload: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'Response received from API'
        },
        status_code: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'HTTP status code'
        },
        status: {
            type: DataTypes.ENUM('SUCCESS', 'FAILED', 'PENDING'),
            allowNull: false,
            comment: 'Status of the API call'
        },
        error_message: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Error message if failed'
        },
        reference_number: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'ARN or reference number from GST Portal'
        },
        filing_date: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Date when return was successfully filed'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        freezeTableName: true,
        indexes: [
            {
                fields: ['return_data_id']
            },
            {
                fields: ['location_code', 'creation_date']
            },
            {
                fields: ['gstin', 'return_period']
            },
            {
                fields: ['status']
            }
        ]
    });

    return GstFilingLog;
};