"use strict";

module.exports = function(sequelize, DataTypes) {
    const TankInvoiceCharges = sequelize.define('t_tank_invoice_charges', {
        id: {
            field: 'id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        invoice_dtl_id: {
            field: 'invoice_dtl_id',
            type: DataTypes.INTEGER
        },
        charge_type: {
            field: 'charge_type',
            type: DataTypes.STRING(50)
        },
        charge_pct: {
            field: 'charge_pct',
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true
        },
        charge_amount: {
            field: 'charge_amount',
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return TankInvoiceCharges;
};
