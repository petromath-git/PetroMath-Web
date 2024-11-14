// HOST IP: "35.174.200.24",
const Sequelize = require("sequelize");
const appConfig = require("../config/app-config");
//const deploymentConfig = "../config/app-deployment-" + process.env.ENVIRONMENT;
const deploymentConfig = "../config/app-deployment-prod";
//const deploymentConfig = "../config/app-deployment-" + process.env.ENVIRONMENT;
const dbConfig = require(deploymentConfig);

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
    host: dbConfig.HOST,
    port: dbConfig.PORT,
    dialect: dbConfig.DIALECT,
    timezone: appConfig.TIMEZONE,
    operatorsAliases: false,
    pool: dbConfig.pool
});

const db = {};

db.schemaName = dbConfig.DB;
db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.location = require("./location")(sequelize, Sequelize);
db.person = require("./person")(sequelize, Sequelize);
db.product = require("./product")(sequelize, Sequelize);
db.pump = require("./pump")(sequelize, Sequelize);
db.credit = require("./credit")(sequelize, Sequelize);
db.expense = require("./expense")(sequelize, Sequelize);
db.lookup = require("./lookup")(sequelize, Sequelize);
db.cashflow_closing = require("./cash-flow-closing")(sequelize, Sequelize);
db.txn_cashflow = require("./txn-cashflow")(sequelize, Sequelize);
db.txn_cashsales = require("./txn-cashsales")(sequelize, Sequelize);
db.txn_closing = require("./txn-closing")(sequelize, Sequelize);
db.txn_reading = require("./txn-reading")(sequelize, Sequelize);
db.txn_2t_oil = require("./txn-2tsales")(sequelize, Sequelize);
db.txn_credits = require("./txn-credits")(sequelize, Sequelize);
db.txn_denom = require("./txn-denomination")(sequelize, Sequelize);
db.txn_expense = require("./txn-expense")(sequelize, Sequelize);
db.txn_closing_views = require("./txn-closing-views")(sequelize, Sequelize);
db.credit_receipts = require("./credit-receipts")(sequelize, Sequelize);
db.cashflow_denoms = require("./cash-flow-denomination")(sequelize, Sequelize);
db.density = require("./density")(sequelize, Sequelize);
db.tank_dip_chart = require("./tank-dip-chart")(sequelize, Sequelize);
db.txn_creditstmt_views = require("./txn-creditstmt-views")(sequelize, Sequelize);
db.txn_tank_stkrcpt = require("./txn-tank-stkrcpt")(sequelize, Sequelize);
db.txn_stkrcpt_dtl = require("./txn-stkrcpt-dtl")(sequelize, Sequelize);
db.tank = require("./tank")(sequelize, Sequelize);
db.txn_tank_receipt_views = require("./txn-tank-receipt-views")(sequelize, Sequelize);
db.txn_truck_load = require("./txn-truck-load")(sequelize, Sequelize);
db.m_tank_truck = require("./tank-truck")(sequelize, Sequelize);
db.m_truck_location = require("./truck-location")(sequelize, Sequelize);
db.decant_out_loc = require("./decant-outloc-views")(sequelize, Sequelize);
db.txn_truck_expense = require("./txn-truck-expense")(sequelize, Sequelize);
db.m_bank = require("./bankaccount")(sequelize, Sequelize);
db.txn_bank_account = require("./txn-bank-account")(sequelize, Sequelize);
db.txn_bank_transaction_view = require("./txn-bank-transaction-view")(sequelize, Sequelize);
db.txn_attendance = require("./txn-attendance")(sequelize, Sequelize);
db.txn_deadline = require("./txn-deadline")(sequelize, Sequelize);
db.txn_deadline_views = require("./txn-deadline-views")(sequelize, Sequelize);

// relations
db.pump.hasMany(db.txn_reading, {foreignKey: 'pump_id'});
db.txn_reading.belongsTo(db.pump, {foreignKey: 'pump_id'});
db.product.hasMany(db.txn_2t_oil, {foreignKey: 'product_id'});
db.txn_2t_oil.belongsTo(db.product, {foreignKey: 'product_id'});
db.expense.hasMany(db.txn_expense, {foreignKey: 'expense_id'});
db.txn_expense.belongsTo(db.expense, {foreignKey: 'Expense_id'});
db.credit_receipts.hasOne(db.credit, {foreignKey: 'creditlist_id', sourceKey: 'creditlist_id'});
db.credit.belongsTo(db.credit_receipts, {foreignKey: 'creditlist_id', targetKey: 'creditlist_id'});
//db.txn_closing.hasMany(db.cashflowClosing, {foreignKey: 'closing_date', targetKey: 'cashflow_date'});
//db.cashflowClosing.belongsTo(db.txn_closing, {foreignKey: 'closing_date', sourceKey: 'cashflow_date'});
db.txn_closing.belongsTo(db.cashflow_closing, {foreignKey: 'closing_date', targetKey: 'cashflow_date'});
db.cashflow_closing.hasMany(db.txn_closing, {foreignKey: 'closing_date', sourceKey: 'cashflow_date'});

db.lookup.hasMany(db.txn_cashflow, {sourceKey: 'description', foreignKey: 'type', constraints: false});
db.txn_cashflow.belongsTo(db.lookup, {foreignKey: 'description', constraints: false});
db.tank.hasMany(db.txn_stkrcpt_dtl, {foreignKey: 'tank_id'});
db.txn_stkrcpt_dtl.belongsTo(db.tank, {foreignKey: 'tank_id'});
db.location.hasMany(db.m_truck_location, {foreignKey:'location_id'});
db.m_truck_location.belongsTo(db.location, {foreignKey:'location_id'});
db.m_tank_truck.hasMany(db.m_truck_location,{foreignKey:'truck_id'});
db.m_truck_location.belongsTo(db.m_tank_truck, {foreignKey:'truck_id'});
db.m_truck_location.hasMany(db.txn_truck_load,{foreignKey: 'truck_id'});
db.txn_truck_load.belongsTo(db.m_truck_location,{foreignKey: 'truck_id',  targetKey: 'truck_id'});
db.m_truck_location.hasMany(db.txn_truck_expense,{foreignKey: 'truck_id'});
db.txn_truck_expense.belongsTo(db.m_truck_location,{foreignKey: 'truck_id', targetKey: 'truck_id'});
db.location.hasMany(db.txn_truck_expense, {foreignKey:'expense_cost_center_id'});
db.txn_truck_expense.belongsTo(db.location, {foreignKey:'expense_cost_center_id'});
db.m_bank.hasMany(db.txn_bank_account, {foreignKey: 'bank_id'});
db.txn_bank_account.belongsTo(db.m_bank,{foreignKey: 'bank_id'});
db.location.hasMany(db.m_bank, {foreignKey: 'location_id'});
db.m_bank.belongsTo(db.location, {foreignKey: 'location_id'});
db.location.hasMany(db.txn_bank_account, {foreignKey: 'location_id'});
db.txn_bank_account.belongsTo(db.location, {foreignKey: 'location_id'});
db.location.hasMany(db.txn_bank_transaction_view, {foreignKey: 'location_id'});
db.txn_bank_transaction_view.belongsTo(db.location, {foreignKey: 'location_id'});
db.location.hasMany(db.txn_deadline, {foreignKey: 'location_id'});
db.txn_deadline.belongsTo(db.location, {foreignKey: 'location_id'});
db.location.hasMany(db.txn_deadline_views, {foreignKey: 'location_id'});
db.txn_deadline_views.belongsTo(db.location, {foreignKey: 'location_id'});

module.exports = db;
