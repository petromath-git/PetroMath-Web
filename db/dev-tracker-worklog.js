// db/dev-tracker-worklog.js
"use strict";

module.exports = function(sequelize, DataTypes) {
    var DevTrackerWorklog = sequelize.define("t_dev_tracker_worklog", {
        worklog_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tracker_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        work_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        hours: {
            type: DataTypes.DECIMAL(5,2),
            allowNull: false
        },
        note: {
            type: DataTypes.STRING(500),
            allowNull: true
        },
        source: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'Manual'
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DevTrackerWorklog;
};
