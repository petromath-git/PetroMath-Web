const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnAttendance = sequelize.define(config.TXN_ATTENDANCE_TABLE, {
        tattendance_id: {
            field: 'tattendance_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        person_id: {
            field: 'person_id',
            type: DataTypes.INTEGER
        },
        shift_type: {
            field: 'shift_type',
            type: DataTypes.STRING
        },
        in_time: {
            field: 'in_time',
            type: DataTypes.TIME,
            //defaultValue: sequelize.fn('NOW')
        },
        out_time: {
            field: 'out_time',
            type: DataTypes.TIME,
            //defaultValue: sequelize.fn('NOW')
        },
        in_date: {
            field: 'in_date',
            type: DataTypes.DATE,
            //defaultValue: sequelize.fn('NOW')
        },
        out_date: {
            field: 'out_date',
            type: DataTypes.DATE,
            //defaultValue: sequelize.fn('NOW')
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
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnAttendance;
};