const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnStkrcptDtl = sequelize.define(config.TXN_STKRCPT_DTL_TABLE, {
        tdtank_id: {
            field: 'tdtank_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        ttank_id: {
            field: 'ttank_id',
            type: DataTypes.INTEGER,
        },
        tank_id: {
            field: 'tank_id',
            type: DataTypes.INTEGER,
        },
        quantity: {
            field: 'quantity',
            type: DataTypes.INTEGER,
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
        closing_dip: {
            field: 'closing_dip',
            type: DataTypes.DECIMAL
        },
        opening_dip: {
            field: 'opening_dip',
            type: DataTypes.DECIMAL
        },
        EB_MS_FLAG: {
            field: 'EB_MS_FLAG',
            type: DataTypes.STRING
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
        },
        closing_water_dip: {
            field: 'closing_water_dip',
            type: DataTypes.DECIMAL
        },
        opening_water_dip: {
            field: 'opening_water_dip',
            type: DataTypes.DECIMAL
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnStkrcptDtl;
};