const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DeadlineTxnsView = sequelize.define(config.TXN_DEADLINE_VIEWS, {
        t_deadline_id: {
            field: 't_deadline_id',
            type: DataTypes.INTEGER,
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },
        message: {
            field: 'message',
            type: DataTypes.STRING
        },
        calculate_days: {
            field: 'calculate_days',
            type: DataTypes.INTEGER
        },
        warning_day: {
            field: 'warning_day',
            type: DataTypes.INTEGER
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        hard_stop: {
            field: 'hard_stop',
            type: DataTypes.STRING,
        },
        closed: {
            field: 'closed',
            type: DataTypes.STRING,
        },
        display_warning: {
            field: 'display_warning',
            type: DataTypes.STRING
        }
       
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DeadlineTxnsView;
};