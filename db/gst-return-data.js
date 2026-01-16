"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var GstReturnData = sequelize.define('t_gst_return_data', {
        return_data_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
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
            type: DataTypes.ENUM('GSTR1', 'GSTR3B', 'GSTR2A', 'GSTR2B'),
            allowNull: false,
            comment: 'Type of GST return'
        },
        return_period: {
            type: DataTypes.STRING(10),
            allowNull: false,
            comment: 'Format: MMYYYY (e.g., 012025 for Jan 2025)'
        },
        financial_year: {
            type: DataTypes.STRING(10),
            allowNull: false,
            comment: 'Format: 2024-25'
        },
        from_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Start date of the return period'
        },
        to_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'End date of the return period'
        },
        return_json: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'Generated JSON for GST return'
        },
        status: {
            type: DataTypes.ENUM('DRAFT', 'READY', 'FILED', 'FAILED', 'CANCELLED'),
            allowNull: false,
            defaultValue: 'DRAFT',
            comment: 'Status of the return'
        },
        total_taxable_value: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            comment: 'Total taxable value'
        },
        total_igst: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: 0
        },
        total_cgst: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: 0
        },
        total_sgst: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: 0
        },
        total_cess: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: 0
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
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
                fields: ['location_code', 'return_type', 'return_period']
            },
            {
                fields: ['gstin', 'return_period']
            },
            {
                fields: ['status']
            }
        ]
    });

    return GstReturnData;
};