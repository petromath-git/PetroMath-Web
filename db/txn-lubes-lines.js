"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var LubesInvoiceLine = sequelize.define(config.LUBES_INVOICE_LINES_TABLE, {
        lubes_line_id: {
            field: 'lubes_line_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        lubes_hdr_id: {
            field: 'lubes_hdr_id',
            type: DataTypes.INTEGER
        },
        product_id: {
            field: 'product_id',
            type: DataTypes.INTEGER
        },
        qty: {
            field: 'qty',
            type: DataTypes.DECIMAL(15, 2)
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL(15, 2)
        },
        mrp: {
            field: 'mrp',
            type: DataTypes.DECIMAL(15, 2)
        },
        net_rate: {
            field: 'net_rate',
            type: DataTypes.DECIMAL(15, 2)
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING(300)
        },
        taxable_value:        { field: 'taxable_value',        type: DataTypes.DECIMAL(12,2), allowNull: true },
        discount_amount:      { field: 'discount_amount',      type: DataTypes.DECIMAL(12,2), allowNull: true },
        cgst_pct:             { field: 'cgst_pct',             type: DataTypes.DECIMAL(5,2),  allowNull: true },
        cgst_amount:          { field: 'cgst_amount',          type: DataTypes.DECIMAL(12,2), allowNull: true },
        sgst_pct:             { field: 'sgst_pct',             type: DataTypes.DECIMAL(5,2),  allowNull: true },
        sgst_amount:          { field: 'sgst_amount',          type: DataTypes.DECIMAL(12,2), allowNull: true },
        // Redesigned entry screen; NULL on legacy rows
        entered_qty:          { field: 'entered_qty',          type: DataTypes.DECIMAL(15,3), allowNull: true },
        entered_uom:          { field: 'entered_uom',          type: DataTypes.STRING(5),     allowNull: true },
        gross_amount:         { field: 'gross_amount',         type: DataTypes.DECIMAL(15,2), allowNull: true },
        cash_discount_amount: { field: 'cash_discount_amount', type: DataTypes.DECIMAL(12,2), allowNull: true },
        igst_pct:             { field: 'igst_pct',             type: DataTypes.DECIMAL(5,2),  allowNull: true },
        igst_amount:          { field: 'igst_amount',          type: DataTypes.DECIMAL(12,2), allowNull: true },
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return LubesInvoiceLine;
};