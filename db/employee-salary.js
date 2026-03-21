"use strict";

module.exports = function(sequelize, DataTypes) {
    const EmployeeSalary = sequelize.define('m_employee_salary', {
        salary_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        employee_id:    DataTypes.INTEGER,
        location_code:  DataTypes.STRING(50),
        salary_amount:  DataTypes.DECIMAL(10, 2),
        salary_type:    { type: DataTypes.STRING(10), defaultValue: 'MONTHLY' },
        effective_from: DataTypes.DATEONLY,
        effective_to:   DataTypes.DATEONLY,   // NULL = currently active
        notes:          DataTypes.STRING(255),
        created_by:     DataTypes.STRING(45),
        creation_date:  DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return EmployeeSalary;
};
