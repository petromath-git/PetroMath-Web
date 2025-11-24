// db/adjustments.js
"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Adjustments = sequelize.define(config.ADJUSTMENTS_TABLE, {
        adjustment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        adjustment_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        reference_no: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        description: {
            type: DataTypes.STRING(500),
            allowNull: false
        },
        external_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        external_source: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        ledger_name: {
            type: DataTypes.STRING(200),
            allowNull: true
        },
        debit_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true
        },
        credit_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true
        },
        adjustment_type: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(20),
            defaultValue: 'ACTIVE'
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
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        recon_match_id: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        manual_recon_flag: {
            type: DataTypes.TINYINT,
            allowNull: true,
            defaultValue: 0
        },
        manual_recon_by: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        manual_recon_date: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Adjustments;
};