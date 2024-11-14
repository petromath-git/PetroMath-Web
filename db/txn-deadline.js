const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DeadlineTxns = sequelize.define(config.TXN_DEADLINE, {
        t_deadline_id: {
            field: 't_deadline_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        deadline_date: {
            field: 'deadline_date',
            type: DataTypes.DATE
        },
        purpose: {
            field: 'purpose',
            type: DataTypes.INTEGER
        },
        warning_day: {
            field: 'warning_day',
            type: DataTypes.INTEGER
        },
        hard_stop: {
            field: 'hard_stop',
            type: DataTypes.STRING,
            defaultValue:'N'
        },
        closed: {
            field: 'closed',
            type: DataTypes.STRING,
            defaultValue:'N'
        },
        comment: {
            field: 'comment',
            type: DataTypes.STRING
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
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

    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DeadlineTxns;
};