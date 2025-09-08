// db/dev-tracker-tasks.js
"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DevTrackerTasks = sequelize.define("t_dev_tracker_tasks", {
        task_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tracker_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        task_title: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        task_description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        task_status: {
            type: DataTypes.ENUM('To Do','In Progress','Done','Blocked'),
            allowNull: false,
            defaultValue: 'To Do'
        },
        task_priority: {
            type: DataTypes.ENUM('Low','Medium','High'),
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
        estimated_hours: {
            type: DataTypes.DECIMAL(5,2),
            allowNull: true
        },
        actual_hours: {
            type: DataTypes.DECIMAL(5,2),
            allowNull: true
        },
        completion_percentage: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 0
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        attachments_json: {
            type: DataTypes.JSON,
            allowNull: true
        },
        is_deleted: {
            type: DataTypes.TINYINT(1),
            allowNull: false,
            defaultValue: 0
        },
        deleted_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        deleted_date: {
            type: DataTypes.DATE,
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
        attachments_json: {
             type: DataTypes.JSON,
             allowNull: true
        },
        sequence_order: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 1
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DevTrackerTasks;
};