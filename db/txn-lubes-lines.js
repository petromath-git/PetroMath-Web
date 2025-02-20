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