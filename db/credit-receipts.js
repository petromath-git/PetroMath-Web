"use strict";
const config = require("../config/app-config");

module.exports = function (sequelize, DataTypes) {
  var creditReceipts = sequelize.define(
    config.TXN_CASHRECEIPT_TABLE,
    {
      treceipt_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      receipt_no: DataTypes.INTEGER,
      creditlist_id: DataTypes.INTEGER,
      digital_creditlist_id: DataTypes.INTEGER,
      receipt_type: DataTypes.STRING,
      amount: DataTypes.DECIMAL,
      notes: DataTypes.STRING,
      location_code: DataTypes.STRING,
      created_by: DataTypes.STRING,
      updated_by: DataTypes.STRING,
      creation_date: DataTypes.DATE,
      updation_date: DataTypes.DATE,
      receipt_date: DataTypes.DATE,
      cashflow_date: DataTypes.DATE,
      receipt_date_fmt: {
        type: DataTypes.DATE
      },
      recon_match_id: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      manual_recon_flag: {
        type: DataTypes.TINYINT,
        allowNull: true,
        defaultValue: 0
      },
      manual_recon_by: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      manual_recon_date: {
        type: DataTypes.DATE,
        allowNull: true
      },
    },
    {
      timestamps: false,
      freezeTableName: true,
    }
  );

  return creditReceipts;
};
