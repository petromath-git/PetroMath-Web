"use strict";

module.exports = function(sequelize, DataTypes) {
    var ImportantLinkRoles = sequelize.define('m_important_link_roles', {
        link_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        },
        role_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return ImportantLinkRoles;
};