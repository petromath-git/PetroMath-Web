const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnClosing = sequelize.define(config.TXN_CLOSING_TABLE, {
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        closer_id: {
            field: 'closer_id',
            type: DataTypes.INTEGER,
        },
        cashier_id: {
            field: 'cashier_id',
            type: DataTypes.INTEGER
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        closing_date: {
            field: 'closing_date',
            type: DataTypes.DATE
        },
        closing_date_fmt1: {
            field: 'closing_date',
            type: DataTypes.DATE        // Dummy fields for UI date formats (closing tab)
        },
        closing_date_fmt2: {
            field: 'closing_date',
            type: DataTypes.DATE        // Dummy fields for UI date formats (summary tab)
        },
        cash: {
            field: 'cash',
            type: DataTypes.INTEGER
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
        },
        closing_status: {
            field: 'closing_status',
            type: DataTypes.STRING,
            defaultValue: 'DRAFT'
        },
        ex_short: {
            field: 'ex_short',
            type: DataTypes.DECIMAL(20, 3)         
        },
        created_by: {
            field: 'created_by',
            type: DataTypes.STRING
        },
        updated_by: {
            field: 'updated_by',
            type: DataTypes.STRING
        },
        creation_date: {
            field: 'creation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        updation_date: {
            field: 'updation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnClosing;
};