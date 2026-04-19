"use strict";

module.exports = function(sequelize, DataTypes) {
    const TankInvoice = sequelize.define('t_tank_invoice', {
        id: {
            field: 'id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.STRING(20)
        },
        supplier_id: {
            field: 'supplier_id',
            type: DataTypes.INTEGER,
            allowNull: false
        },
        supplier: {
            field: 'supplier',
            type: DataTypes.STRING(10),
            allowNull: true
        },
        invoice_number: {
            field: 'invoice_number',
            type: DataTypes.STRING(50),
            allowNull: true
        },
        invoice_date: {
            field: 'invoice_date',
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        truck_number: {
            field: 'truck_number',
            type: DataTypes.STRING(20),
            allowNull: true
        },
        delivery_doc_no: {
            field: 'delivery_doc_no',
            type: DataTypes.STRING(50),
            allowNull: true
        },
        seal_lock_no: {
            field: 'seal_lock_no',
            type: DataTypes.STRING(100),
            allowNull: true
        },
        total_invoice_amount: {
            field: 'total_invoice_amount',
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true
        },
        created_at: {
            field: 'created_at',
            type: DataTypes.DATE
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return TankInvoice;
};
