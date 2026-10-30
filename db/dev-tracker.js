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
        // Cause / fix / files / DB / PRs / verify / gotchas for the next person. SuperUser only.
        dev_notes: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Claude conversation usage for the ticket: tokens, and cost at API list prices. SuperUser only.
        claude_tokens: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        claude_cost_usd: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true
        },
        // Claude conversations, one per line (https link or session id). SuperUser only.
        claude_links: {
            type: DataTypes.TEXT,
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
        scope: {
            type: DataTypes.ENUM('LOCATION','ALL'),
            allowNull: false,
            defaultValue: 'LOCATION'
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
        },
        is_deleted: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            defaultValue: false
        },
        deleted_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        deleted_date: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DevTracker;
};