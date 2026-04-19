"use strict";

module.exports = function(sequelize, DataTypes) {
    const TankInvoiceDtl = sequelize.define('t_tank_invoice_dtl', {
        id: {
            field: 'id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        invoice_id: {
            field: 'invoice_id',
            type: DataTypes.INTEGER
        },
        product_id: {
            field: 'product_id',
            type: DataTypes.INTEGER,
            allowNull: false
        },
        product_name: {
            field: 'product_name',
            type: DataTypes.STRING(100),
            allowNull: true
        },
        quantity: {
            field: 'quantity',
            type: DataTypes.DECIMAL(8, 3),
            allowNull: true
        },
        rate_per_kl: {
            field: 'rate_per_kl',
            type: DataTypes.DECIMAL(10, 3),
            allowNull: true
        },
        density: {
            field: 'density',
            type: DataTypes.DECIMAL(6, 3),
            allowNull: true
        },
        hsn_code: {
            field: 'hsn_code',
            type: DataTypes.STRING(20),
            allowNull: true
        },
        total_line_amount: {
            field: 'total_line_amount',
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return TankInvoiceDtl;
};
