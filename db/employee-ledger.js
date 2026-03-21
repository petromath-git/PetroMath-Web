"use strict";

module.exports = function(sequelize, DataTypes) {
    const EmployeeLedger = sequelize.define('t_employee_ledger', {
        ledger_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        employee_id:    DataTypes.INTEGER,
        location_code:  DataTypes.STRING(50),
        txn_date:       DataTypes.DATEONLY,
        txn_type:       DataTypes.STRING(30),
        credit_amount:  { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
        debit_amount:   { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
        description:    DataTypes.STRING(255),
        reference_id:   DataTypes.INTEGER,
        salary_period:  DataTypes.STRING(10),  // YYYY-MM or YYYY-WNN — informational only
        created_by:     DataTypes.STRING(45),
        creation_date:  DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return EmployeeLedger;
};
