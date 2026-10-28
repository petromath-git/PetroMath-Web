// db/dev-tracker-comments.js
"use strict";

module.exports = function(sequelize, DataTypes) {
    var DevTrackerComments = sequelize.define("t_dev_tracker_comments", {
        comment_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        tracker_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        comment_text: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        is_internal: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
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

    return DevTrackerComments;
};
