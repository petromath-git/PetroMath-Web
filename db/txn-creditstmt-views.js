const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnCreditStmtViews = sequelize.define(config.TXN_CREDITSTMT_VIEW, {
        tran_date: {
            field: 'tran_date',
            type: DataTypes.DATE
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        bill_no: {
            field: 'bill_no',
            type: DataTypes.STRING
        },
        company_name: {
            field: 'company_name',
            type: DataTypes.STRING,
        },
        creditlist_id: {
            field: 'creditlist_id',
            type: DataTypes.INTEGER
        },
        product_name: {
            field: 'product_name',
            type: DataTypes.STRING,
        },
        price: {
            field: 'price',
            type: DataTypes.DECIMAL
        },
        price_discount: {
            field: 'price_discount',
            type: DataTypes.DECIMAL
        },
        qty: {
            field: 'qty',
            type: DataTypes.DECIMAL
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
        },
        
        
    }, {
        timestamps: false,
        freezeTableName: true
    });
    TxnCreditStmtViews.removeAttribute('id');

    return TxnCreditStmtViews;
};