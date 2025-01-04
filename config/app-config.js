const MS_DESC = "MS"; // Motor Spirit
const HSD_DESC = "HSD"; // High Speed Diesel
const XMS_DESC = "XMS"; // Xtra Premium Petrol

const MS_LABEL = "MS";
const HSD_LABEL = "HSD";
const XMS_LABEL = "XMS";

const MS_TAG = "msrate";
const HSD_TAG = "hsdrate";
const XMS_TAG = "xmsrate";

const POUCH_DESC = "2T POUCH";
const LOOSE_DESC = "2T LOOSE";
const LOOSE_TAG = "loose2t";
const POUCH_TAG = "pouch2t";

const cashSaleTypes = ["Credit", "Debit"];
const cashSaleTypeCodes = new Map();
cashSaleTypeCodes.set(cashSaleTypes[0], 'IN');
cashSaleTypeCodes.set(cashSaleTypes[1], 'OUT');

const CASHIER_ROLES = ["Cashier"];
const MANAGER_ROLES = ["Manager"];
const ADMIN_ROLES = ["admin"];

const PRODUCT_PUMPS = [MS_DESC, HSD_DESC, XMS_DESC];
const PRODUCT_2T = [POUCH_DESC, LOOSE_DESC];
const PRODUCTS = PRODUCT_2T.concat(PRODUCT_PUMPS);

// config related to sales
const MAX_CREDITS_ROW_CNT = 300;
const MAX_CASH_SALES_ROW_CNT = 25;
const MAX_EXPENSES_ROW_CNT = 25;
const MAX_CASHFLOWS_ROW_CNT = 30;
const CURRENCY = "Rs. ";
const PRODUCT_ALIASES = [MS_LABEL, HSD_LABEL, XMS_LABEL];
const DENOMINATION_VALUES = [
  { id: 0, label: "Cash" },
  { id: 2000, label: "2000*" },
  { id: 500, label: "500*" },
  { id: 200, label: "200*" },
  { id: 100, label: "100*" },
  { id: 50, label: "50*" },
  { id: 20, label: "20*" },
  { id: 10, label: "10*" },
  { id: 1, label: "Coins" },
];
const CASH_FLOW_DENOMINATION_VALUES = [
    { id: 2000, label: "2000*" },
    { id: 500, label: "500*" },
    { id: 200, label: "200*" },
    { id: 100, label: "100*" },
    { id: 50, label: "50*" },
    { id: 20, label: "20*" },
    { id: 10, label: "10*" },
    { id: 1, label: "Coins" },
];

const MAX_ALLOWED_DRAFTS_PER_LOCATION = 10;
const MAX_ALLOWED_DRAFTS_DAYS_PER_LOCATION = 5;
const CREDIT_RECEIPT_EDIT_DELETE_ALLOWED_DAYS = 1;
const RECEIPT_TYPES = [
  {id:'cash', label: 'Cash'},
  {id:'cheque', label: 'Cheque'},
  {id:'online_txn', label: 'RTGS/NEFT'},
  {id:'bank_deposit', label: 'Bank Deposit'},
  {id:'fleet_card', label: 'Fleet Card'},
  {id:'others', label: 'Others'},
];

module.exports = {

  // DB table config
  LOCATION_TABLE: "m_location",
  PERSON_TABLE: "m_persons",
  PRODUCT_TABLE: "m_product",
  PUMP_TABLE: "m_pump",
  CREDIT_TABLE: "m_credit_list",
  EXPENSE_TABLE: "m_expense",
  CASHFLOW_CLOSING_TABLE: "t_cashflow_closing",
  TXN_CASHFLOW_TABLE: "t_cashflow_transaction",
  TXN_CLOSING_TABLE: "t_closing",
  TXN_READING_TABLE: "t_reading",
  TXN_2TSALES_TABLE: "t_2toil",
  TXN_EXPENSE_TABLE: "t_expense",
  TXN_CREDITS_TABLE: "t_credits",
  TXN_TESTING_TABLE: "t_testing",
  TXN_DENOMINATION_TABLE: "t_denomination",
  TXN_CASHSALES_TABLE: "t_cashsales",
  TXN_CASHRECEIPT_TABLE: "t_receipts",
  TXN_CLOSING_VIEW: "t_indiv_closing_sales_v",
  TXN_CASH_FLOW_DENOMINATION_TABLE: "t_cashflow_denomination",
  DENSITY_TABLE:"m_density",
  TANK_DIP_CHART_TABLE: "m_tank_dip_chart",
  TXN_CREDITSTMT_VIEW:"t_credit_stmt_v",
  TXN_TANK_STK_RECEIPT_TABLE: "t_tank_stk_rcpt",
  TXN_STK_DETAILS_TABLE: "t_tank_stk_rcpt_dtl",
  TANK_TABLE: "m_tank",
  TXN_TANK_RECEIPT_VIEW: "t_tank_receipt_v",
  TXN_TRUCK_LOAD: "t_truck_load",
  TANK_TRUCK_TABLE: "m_tank_truck",
  TRUCK_LOCATION_TABLE: "m_truck_location",
  DECANT_OUT_LOC_VIEW: "m_decant_out_location_v",
  TXN_TRUCK_EXPENSE:"t_truckexpense",
  BANK_TABLE:"m_bank",
  TXN_BANK_ACCOUNTS:"t_bank_transaction",
  TXN_BANK_TRANS_VIEW: "t_bank_transaction_v",
  TXN_ATTENDANCE_TABLE: "t_attendance",
  TXN_DEADLINE: "t_deadline",
  TXN_DEADLINE_VIEWS: "t_deadline_v",
  PUMP_TANK_TABLE: "m_pump_tank",
  TXN_TANK_DIP: "t_tank_dip",
  TXN_TANK_READING: "t_tank_reading",



  // App timezone
  //TIMEZONE: '-07:00', // PST timezone - for writing to database
  TIMEZONE: "+05:50", // India timezone - for writing to database

  // DB table config
  PERSON_TABLE: "m_persons",
  PRODUCT_TABLE: "m_product",
  PUMP_TABLE: "m_pump",
  CREDIT_TABLE: "m_credit_list",
  EXPENSE_TABLE: "m_expense",
  LOOKUP_TABLE: "m_lookup",
  TXN_CLOSING_TABLE: "t_closing",
  TXN_READING_TABLE: "t_reading",
  TXN_2TSALES_TABLE: "t_2toil",
  TXN_EXPENSE_TABLE: "t_expense",
  TXN_CREDITS_TABLE: "t_credits",
  TXN_RECEIPT_TABLE: "t_receipts",
  TXN_TESTING_TABLE: "t_testing",
  TXN_DENOMINATION_TABLE: "t_denomination",
  TXN_CASHSALES_TABLE: "t_cashsales",
  TXN_CLOSING_VIEW: "t_indiv_closing_sales_v",
  TXN_CREDITSTMT_VIEW:"t_credit_stmt_v",
  TXN_TANK_STK_RECEIPT_TABLE: "t_tank_stk_rcpt",
  TXN_STKRCPT_DTL_TABLE: "t_tank_stk_rcpt_dtl",
  TANK_TABLE: "m_tank",
  TXN_TANK_RECEIPT_VIEW: "t_tank_receipt_v",
  TXN_TRUCK_LOAD: "t_truck_load",
  TANK_TRUCK_TABLE: "m_tank_truck",
  TRUCK_LOCATION_TABLE: "m_truck_location",
  DECANT_OUT_LOC_VIEW: "m_decant_out_location_v",
  TXN_TRUCK_EXPENSE:"t_truckexpense",
  BANK_TABLE:"m_bank",
  TXN_BANK_ACCOUNTS:"t_bank_transaction",
  TXN_BANK_TRANS_VIEW: "t_bank_transaction_v",
  TXN_ATTENDANCE_TABLE: "t_attendance",
  TXN_DEADLINE: "t_deadline",
  TXN_DEADLINE_VIEWS: "t_deadline_v",

  // config related to sales
  APP_CONFIGS: {
      maxCreditsRowCnt: MAX_CREDITS_ROW_CNT,
      maxCashSalesRowCnt: MAX_CASH_SALES_ROW_CNT,
      maxExpensesRowCnt: MAX_EXPENSES_ROW_CNT,
      maxCashFlowRowsCnt: MAX_CASHFLOWS_ROW_CNT,
      currency: CURRENCY,
      productAliases: PRODUCT_ALIASES,
      denominationValues: DENOMINATION_VALUES,
      denominationValuesJson: JSON.stringify(DENOMINATION_VALUES),
      cashFlowDenominationValues: CASH_FLOW_DENOMINATION_VALUES,
      cashFlowDenominationValuesJson: JSON.stringify(CASH_FLOW_DENOMINATION_VALUES),
      maxAllowedDrafts: MAX_ALLOWED_DRAFTS_PER_LOCATION,
      maxAllowedDraftsDays: MAX_ALLOWED_DRAFTS_DAYS_PER_LOCATION + 1,
      receiptEditOrDeleteAllowedDays: CREDIT_RECEIPT_EDIT_DELETE_ALLOWED_DAYS,
      maxDaysAllowedToGoBackForNewClosing : MAX_ALLOWED_DRAFTS_DAYS_PER_LOCATION,
      creditTypes: ['Credit', 'Suspense'],
      cashSaleTypes: cashSaleTypes,
      cashSaleTypeCodes: cashSaleTypeCodes,
      receiptTypes: RECEIPT_TYPES,
      adminRoles: MANAGER_ROLES + ADMIN_ROLES,
      tankQuantity: ['4','8','12','5','10'],
      productUnits: ['LIT', 'NOS'],
      decantTimelists: ['0.00','0.30','1.00','1.30','2.00','2.30','3.00','3.30','4.00','4.30','5.00','5.30','6.00','6.30','7.00','7.30',
                        '8.00','8.30','9.00','9.30','10.00','10.30','11.00','11.30','12.00','12.30','13.00','13.30',
                        '14.00','14.30','15.00','15.30','16.00','16.30','17.00','17.30','18.00','18.30','19.00','19.30',                       
                        '20.00','20.30','21.00','21.30','22.00','22.30','23.00','23.30'],
      shiftType: ['Morning', 'Night']
  },

  // Map for textName
  MS_DESC: MS_DESC,
  HSD_DESC: HSD_DESC,
  XMS_DESC: XMS_DESC,
  POUCH_DESC: POUCH_DESC,
  LOOSE_DESC: LOOSE_DESC,

  PRODUCT_DETAILS_MAPPING: setProductDetailsMap(),
  PRODUCT_PUMPS: PRODUCT_PUMPS,
  PRODUCT_2T: PRODUCT_2T,
  PRODUCTS: PRODUCTS,
};

function setProductDetailsMap() {
  let productMap = new Map();
  productMap.set(MS_DESC, { label: MS_LABEL, tag: MS_TAG });
  productMap.set(HSD_DESC, { label: HSD_LABEL, tag: HSD_TAG });
  productMap.set(XMS_DESC, { label: XMS_LABEL, tag: XMS_TAG });
  productMap.set(POUCH_DESC, { tag: POUCH_TAG });
  productMap.set(LOOSE_DESC, { tag: LOOSE_TAG });
  return productMap;
}
