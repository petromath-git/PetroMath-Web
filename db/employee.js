"use strict";

module.exports = function(sequelize, DataTypes) {
    const Employee = sequelize.define('m_employee', {
        employee_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        employee_code:  DataTypes.STRING(20),
        location_code:  DataTypes.STRING(50),
        name:           DataTypes.STRING(100),
        nickname:       DataTypes.STRING(50),
        mobile:         DataTypes.STRING(15),
        designation:    DataTypes.STRING(50),
        joined_date:    DataTypes.DATEONLY,
        left_date:      DataTypes.DATEONLY,
        is_active:      { type: DataTypes.CHAR(1), defaultValue: 'Y' },
        person_id:      DataTypes.INTEGER,
        photo_doc_id:   DataTypes.INTEGER,   // FK to t_document_store
        notes:          DataTypes.TEXT,
        created_by:     DataTypes.STRING(45),
        updated_by:     DataTypes.STRING(45),
        creation_date:  DataTypes.DATE,
        updation_date:  DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return Employee;
};
