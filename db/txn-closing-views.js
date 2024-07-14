const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnClosingViews = sequelize.define(config.TXN_CLOSING_VIEW, {
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        person_name: {
            field: 'person_name',
            type: DataTypes.STRING
        },
        closing_date_formatted: {
            field: 'Closing_Date_formatted',
            type: DataTypes.STRING
        },
        closing_date: {
            field: 'closing_date',
            type: DataTypes.DATE
        },
        MS: {
            field: 'MS',
            type: DataTypes.DECIMAL
        },
        HSD: {
            field: 'HSD',
            type: DataTypes.DECIMAL
        },
        XMS: {
            field: 'XMS',
            type: DataTypes.DECIMAL
        },
        l_2t: {
            field: '2T Loose',
            type: DataTypes.DECIMAL
        },
        p_2t: {
            field: '2T Pouch',
            type: DataTypes.DECIMAL
        },
        closing_status: {
            field: 'closing_status',
            type: DataTypes.STRING,
            defaultValue: 'DRAFT'
        },
        ex_short: {
            field: 'ex_short',
            type: DataTypes.DECIMAL,
        },
        period: {
            field: 'period',
            type: DataTypes.STRING
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnClosingViews;
};