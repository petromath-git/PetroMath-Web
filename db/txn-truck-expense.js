const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnTruckExpense = sequelize.define(config.TXN_TRUCK_EXPENSE, {
        truckexp_id: {
            field: 'truckexp_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        truck_id: {
            field: 'truck_id',
            type: DataTypes.INTEGER
        },
        expense_id: {
            field: 'expense_id',
            type: DataTypes.INTEGER
        },
        costcenter_id: {
            field: 'expense_cost_center_id',
            type: DataTypes.INTEGER
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        },
        qty: {
            field: 'qty',
            type: DataTypes.DECIMAL
        },
        payment_mode: {
            field: 'payment_mode',
            type: DataTypes.STRING
        },
        expense_date: {
            field: 'expense_date',
            type: DataTypes.DATE
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
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
        },
        cashflow_done_flag: {
            field: 'cashflow_done_flag',
            type: DataTypes.STRING,
            defaultValue:'N'
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnTruckExpense;
};