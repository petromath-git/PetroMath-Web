"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Supplier = sequelize.define("m_supplier", {
        supplier_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false,
            field: 'supplier_id'
        },
        supplier_name: {
            type: DataTypes.STRING(300),
            allowNull: false,
            field: 'supplier_name'
        },
        supplier_short_name: {
            type: DataTypes.STRING(300),
            allowNull: false,
            field: 'supplier_short_name'
        },
        gstin: {
            type: DataTypes.STRING(15),
            allowNull: true,
            comment: 'Supplier GSTIN for GST ITC claims'
        },
        location_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'location_id'
        },
        location_code: {
            type: DataTypes.STRING(10),
            allowNull: true,
            field: 'location_code'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true,
            field: 'created_by'
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true,
            field: 'updated_by'
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
            field: 'updation_date'
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
            field: 'creation_date'
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            field: 'effective_start_date'
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            field: 'effective_end_date'
        }
    }, {
        timestamps: false,
        freezeTableName: true,
        tableName: 'm_supplier'
    });
    return Supplier;
};