"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var LubesInvoiceHeader = sequelize.define(config.LUBES_INVOICE_HDR_TABLE, {
        lubes_hdr_id: {
            autoIncrement: true,
            field: 'lubes_hdr_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
        },
        invoice_date: {
            field: 'invoice_date',
            type: DataTypes.DATE
        },
        invoice_number: {
            field: 'invoice_number',
            type: DataTypes.STRING
        },
        supplier_id: {
            field: 'supplier_id',
            type: DataTypes.INTEGER
        },
        invoice_amount: {
            field: 'invoice_amount',
            type: DataTypes.DECIMAL(15, 2)
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING(300)
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING(10)
        },
        closing_status: {
            field: 'closing_status',
            type: DataTypes.STRING(45)
        },
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return LubesInvoiceHeader;
};