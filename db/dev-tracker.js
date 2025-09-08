// db/dev-tracker.js
"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DevTracker = sequelize.define("t_dev_tracker", {
        tracker_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        type: {
            type: DataTypes.ENUM('Bug','Feature','Enhancement','Task'),
            allowNull: false,
            defaultValue: 'Task'
        },
        status: {
            type: DataTypes.ENUM('Open','In Progress','Testing','Complete','Closed'),
            allowNull: false,
            defaultValue: 'Open'
        },
        priority: {
            type: DataTypes.ENUM('Low','Medium','High','Critical'),
            allowNull: false,
            defaultValue: 'Medium'
        },
        assigned_to: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        due_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        },
        tags: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        estimated_hours: {
            type: DataTypes.DECIMAL(5,2),
            allowNull: true
        },
        actual_hours: {
            type: DataTypes.DECIMAL(5,2),
            allowNull: true
        },
        attachments_json: {
            type: DataTypes.JSON,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DevTracker;
};