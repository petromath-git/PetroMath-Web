// Creates (or resets) the made-up DEMO location on BETA that the how-to videos are recorded at (ticket #471).
// Made-up station, staff, customers and prices only, so no dealer's real data appears in a video.
// Running it again deletes every DEMO shift and puts the meters, prices and masters back, so each
// recording starts from the same screens.
//
//   pm-tunnel beta db        (in another window; the beta DB is reached through the SSM tunnel)
//   node demo-location.js
//
// Every write is scoped to location_code 'DEMO'. Refuses to run against the prod DB.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const LOC = 'DEMO';
const PROD_HOSTS = ['13.205.41.114'];
const PROD_TUNNEL_PORT = 33307;

const LOCATION = {
  location_name: 'DEMO FUELS (VIDEO DEMO)', address: 'GANDHI ROAD, ERODE', place: 'ERODE', company_name: 'IOCL',
};
const CONFIG = {
  PUMP_OPENING_READING_READONLY: 'Y',
  MAX_DAYS_ALLOWED_BACK_DATE_CLOSING: '2',
  SHOW_2T_SALES_TAB: 'N',
  SHOW_EXSHORT_BREAKDOWN: 'Y',
  GOLIVE_DATE: '2026-01-01', // else bank lines dated before the first DEMO shift are skipped as "before go-live"
  // The two optional shift tabs (on at about ten stations): customer payments taken in the shift, and staff advances.
  ALLOW_CREDIT_RECEIPTS_IN_CLOSING: 'Y',
  ALLOW_EMPLOYEE_ADVANCE_IN_CLOSING: 'Y',
  // Every real station with those tabs has cashflow on. With it off (the '*' default), a receipt saved by autosave
  // and then again by Next is refused as "already part of a cashflow/day close" (txn-write-dao saveCreditReceipts).
  CASHFLOW_ENABLED: 'true',
};
// Employees (Employee Advance tab): code, name, designation
const EMPLOYEES = [['E001', 'ARUN KUMAR', 'Cashier'], ['E002', 'SELVI M', 'Cashier'], ['E003', 'RAJESH P', 'Pump Attendant'],
  ['E004', 'MURUGAN S', 'Cashier']];
// name, price, colour
const FUELS = [['MS', 100.80, '217,234,211'], ['HSD', 92.40, '172,197,220'], ['XP95', 108.50, '234,209,220']];
// name, price, unit (default NOS). The last four are how MUE stocks the SERVO items on the real Sakthi Ganesh
// invoice the lube-invoice video uploads.
const LUBES = [
  ['ENGINE OIL 4T 1 LTR', 420], ['ENGINE OIL 4T 500 ML', 230], ['GEAR OIL 90 1 LTR', 355],
  ['COOLANT 1 LTR', 250], ['BRAKE OIL 500 ML', 220], ['DISTILLED WATER 1 LTR', 40],
  ['2T LOOSE', 440, 'LIT'], ['4T SCOOTOMATIC 800ML', 483], ['4T 20W40 1 LTR', 518], ['HYPERSPORT 1 LTR', 900],
];
// tank code, product, capacity
const TANKS = [['T1', 'MS', 20000], ['T2', 'HSD', 20000], ['T3', 'XP95', 15000]];
// nozzle, product, tank, opening meter reading, display order
const NOZZLES = [
  ['MS-1', 'MS', 'T1', 245310.500, 1], ['MS-2', 'MS', 'T1', 187642.250, 2],
  ['HSD-1', 'HSD', 'T2', 412785.750, 3], ['HSD-2', 'HSD', 'T2', 298413.000, 4],
  ['XP-1', 'XP95', 'T3', 56230.400, 5],
];
const MANAGER = { name: 'DEMO MANAGER', role: 'Manager' };
const STAFF = [['ARUN KUMAR', 'Cashier'], ['SELVI M', 'Cashier'], ['KARTHIK R', 'Cashier'], ['MURUGAN S', 'Cashier']];
// customer, vehicles
const CUSTOMERS = [
  ['SRI LAKSHMI TRANSPORTS', ['TN33 AB 1234', 'TN33 AB 5678']],
  ['KAVERI ROADWAYS', ['TN56 C 4321']],
  ['GREEN VALLEY SCHOOL', ['TN33 BZ 0909']],
  ['ERODE TEXTILE TRADERS', ['TN33 Q 7777']],
];
const DIGITAL = ['PAYTM', 'CARD SWIPE', 'FLEET CARD'];
// The station's bank account for the bank-upload video. bank_name 'IOB' picks the "IOB New Portal 2026" statement template.
// The oil company (SAP) account is created by the m_location insert trigger; it is only renamed below.
const BANK = { bank_name: 'IOB', account_number: '123402000001234', account_nickname: 'IOB CA 1234', ledger_name: 'INDIAN OVERSEAS BANK CA 1234',
  bank_branch: 'ERODE MAIN', ifsc_code: 'IOBA0001234', type: 'Current' };
const SAP = { account_number: '30210400001234', account_nickname: 'SAP-001234' };
const TEMPLATE_LOC = 'MUE'; // copy account heads and per-bank ledger rules from here, as onboarding does
// MUE's SERVO distributor (the lube-invoice video uploads one of its real invoices), with its SKUs already
// linked to the products above, as they are after the first invoice.
const LUBE_SUPPLIER = { name: 'SAKTHI GANESH AUTO SERVICE', short: 'SGS', gstin: '33AFZPK4889H1ZM' };
const LUBE_SKU_LINKS = [['SKU:429000401', '2T LOOSE'], ['SKU:428860156', '4T SCOOTOMATIC 800ML'],
  ['SKU:621440229', '4T 20W40 1 LTR'], ['SKU:621440181', 'HYPERSPORT 1 LTR']];

async function main() {
  const host = process.env.BETA_DB_HOST;
  const port = Number(process.env.BETA_DB_PORT);
  if (PROD_HOSTS.includes(host) || port === PROD_TUNNEL_PORT) throw new Error('This points at the PROD database. The demo location lives on beta only.');
  if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 10) throw new Error('Set DEMO_PASSWORD (10+ characters) in tools/videos/.env');

  const db = await mysql.createConnection({
    host, port, user: process.env.BETA_DB_USER, password: process.env.BETA_DB_PASSWORD,
    database: process.env.BETA_DB_NAME, dateStrings: true,
  });
  const q = async (sql, params) => (await db.query(sql, params))[0];
  const one = async (sql, params) => (await q(sql, params))[0];

  try {
    // ── Location (its insert trigger seeds expenses, cashflow heads and ledger rules) ──
    if (!(await one('SELECT location_id FROM m_location WHERE location_code = ?', [LOC]))) {
      await q(`INSERT INTO m_location (location_code, location_name, address, place, company_name, start_date, effective_end_date,
                 created_by, updated_by, creation_date)
               VALUES (?, ?, ?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`,
      [LOC, LOCATION.location_name, LOCATION.address, LOCATION.place, LOCATION.company_name]);
      console.log('Created location DEMO');
    }

    // Beta lets a location sign in only with an active canary row (Beta Access screen).
    if (!(await one(`SELECT routing_id FROM m_version_routing WHERE location_code = ? AND app_version = 'canary'
                       AND effective_start_date <= NOW() AND (effective_end_date IS NULL OR effective_end_date > NOW())`, [LOC]))) {
      await q(`INSERT INTO m_version_routing (location_code, app_version, effective_start_date, effective_end_date, updated_by)
               VALUES (?, 'canary', NOW(), NULL, 'video-demo')`, [LOC]);
    }

    // Managers see Digital Reconciliation only where it is granted per location (as at MC, MUE, MME, MC2).
    if (!(await one("SELECT access_id FROM m_menu_access_override WHERE role = 'Manager' AND location_code = ? AND menu_code = 'REPORT_DIGITAL_RECON'", [LOC]))) {
      await q(`INSERT INTO m_menu_access_override (role, location_code, menu_code, allowed, effective_start_date, created_by, updated_by)
               VALUES ('Manager', ?, 'REPORT_DIGITAL_RECON', 1, '2026-01-01', 'video-demo', 'video-demo')`, [LOC]);
    }

    for (const [name, value] of Object.entries(CONFIG)) {
      const row = await one('SELECT config_id FROM m_location_config WHERE location_code = ? AND setting_name = ?', [LOC, name]);
      if (row) {
        await q("UPDATE m_location_config SET setting_value = ?, effective_end_date = '9999-12-31' WHERE config_id = ?", [value, row.config_id]);
      } else {
        await q(`INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by, updated_by)
                 VALUES (?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo')`, [LOC, name, value]);
      }
    }

    // ── Products ──
    for (const [name, price, rgb] of FUELS) {
      const p = await one('SELECT product_id FROM m_product WHERE location_code = ? AND product_name = ?', [LOC, name]);
      if (p) await q('UPDATE m_product SET price = ? WHERE product_id = ?', [price, p.product_id]);
      else {
        await q(`INSERT INTO m_product (product_name, location_code, qty, unit, price, is_tank_product, rgb_color, hsn_code,
                   cgst_percent, sgst_percent, product_type, sku_name, created_by, updated_by)
                 VALUES (?, ?, 1, 'LIT', ?, 1, ?, '271019', 0, 0, ?, ?, 'video-demo', 'video-demo')`,
        [name, LOC, price, rgb, name === 'XP95' ? null : name, name]);
      }
    }
    for (const [name, price, unit = 'NOS'] of LUBES) {
      const p = await one('SELECT product_id FROM m_product WHERE location_code = ? AND product_name = ?', [LOC, name]);
      if (p) await q('UPDATE m_product SET price = ? WHERE product_id = ?', [price, p.product_id]);
      else {
        await q(`INSERT INTO m_product (product_name, location_code, qty, unit, price, is_lube_product, hsn_code,
                   cgst_percent, sgst_percent, sku_name, created_by, updated_by)
                 VALUES (?, ?, 1, ?, ?, 1, '27101973', 9, 9, ?, 'video-demo', 'video-demo')`, [name, LOC, unit, price, name]);
      }
    }

    // ── Tanks and nozzles ──
    for (const [code, product, capacity] of TANKS) {
      if (!(await one('SELECT tank_id FROM m_tank WHERE location_code = ? AND tank_code = ?', [LOC, code]))) {
        await q(`INSERT INTO m_tank (tank_code, product_code, location_code, tank_orig_capacity, tank_opening_stock,
                   effective_start_date, effective_end_date, created_by, updated_by, creation_date)
                 VALUES (?, ?, ?, ?, 0, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`, [code, product, LOC, capacity]);
      }
    }
    for (const [code, product, tank, opening, order] of NOZZLES) {
      const p = await one('SELECT pump_id FROM m_pump WHERE location_code = ? AND pump_code = ?', [LOC, code]);
      if (p) {
        await q('UPDATE m_pump SET opening_reading = ?, display_order = ? WHERE pump_id = ?', [opening, order, p.pump_id]);
        continue;
      }
      const [r] = await db.query(
        `INSERT INTO m_pump (pump_code, pump_make, product_code, opening_reading, location_code, effective_start_date, effective_end_date,
           current_stamping_date, Stamping_due, display_order, created_by, updated_by)
         VALUES (?, 'GVR', ?, ?, ?, '2026-01-01', '9999-12-31', '2026-01-01', '2027-01-01', ?, 'video-demo', 'video-demo')`,
        [code, product, opening, LOC, order]);
      const t = await one('SELECT tank_id FROM m_tank WHERE location_code = ? AND tank_code = ?', [LOC, tank]);
      await q(`INSERT INTO m_pump_tank (pump_id, tank_id, location_code, effective_start_date, effective_end_date, created_by, updated_by)
               VALUES (?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo')`, [r.insertId, t.tank_id, LOC]);
    }

    // ── People: the demo login (a Manager) and the cashiers ──
    const hash = await bcrypt.hash(process.env.DEMO_PASSWORD, 12);
    const userName = process.env.DEMO_USER || 'DEMO-MGR';
    const mgr = await one('SELECT Person_id, location_code FROM m_persons WHERE User_Name = ?', [userName]);
    if (mgr && mgr.location_code !== LOC) throw new Error(`User name ${userName} already belongs to ${mgr.location_code}`);
    if (mgr) {
      await q(`UPDATE m_persons SET Person_Name = ?, Password = ?, Role = ?, effective_end_date = '9999-12-31' WHERE Person_id = ?`,
        [MANAGER.name, hash, MANAGER.role, mgr.Person_id]);
    } else {
      await q(`INSERT INTO m_persons (Person_Name, User_Name, Password, Role, location_code, effective_start_date, effective_end_date,
                 created_by, updated_by, creation_date)
               VALUES (?, ?, ?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`,
      [MANAGER.name, userName, hash, MANAGER.role, LOC]);
    }
    // The owner's login (Admin): only Admins can add customers. Same password as the Manager's.
    const adminUser = process.env.DEMO_ADMIN_USER || 'DEMO-ADMIN';
    const adm = await one('SELECT Person_id, location_code FROM m_persons WHERE User_Name = ?', [adminUser]);
    if (adm && adm.location_code !== LOC) throw new Error(`User name ${adminUser} already belongs to ${adm.location_code}`);
    if (adm) {
      await q("UPDATE m_persons SET Person_Name = 'DEMO OWNER', Password = ?, Role = 'Admin', effective_end_date = '9999-12-31' WHERE Person_id = ?",
        [hash, adm.Person_id]);
    } else {
      await q(`INSERT INTO m_persons (Person_Name, User_Name, Password, Role, location_code, effective_start_date, effective_end_date,
                 created_by, updated_by, creation_date)
               VALUES ('DEMO OWNER', ?, ?, 'Admin', ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`, [adminUser, hash, LOC]);
    }
    for (const [name, role] of STAFF) {
      if (!(await one('SELECT Person_id FROM m_persons WHERE location_code = ? AND Person_Name = ?', [LOC, name]))) {
        await q(`INSERT INTO m_persons (Person_Name, Role, location_code, effective_start_date, effective_end_date, created_by, updated_by, creation_date)
                 VALUES (?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`, [name, role, LOC]);
      }
    }
    for (const [code, name, designation] of EMPLOYEES) {
      if (!(await one('SELECT employee_id FROM m_employee WHERE location_code = ? AND employee_code = ?', [LOC, code]))) {
        await q(`INSERT INTO m_employee (employee_code, location_code, name, designation, joined_date, is_active, created_by, updated_by)
                 VALUES (?, ?, ?, ?, '2026-01-01', 'Y', 'video-demo', 'video-demo')`, [code, LOC, name, designation]);
      }
    }

    // ── Credit customers with vehicles, and digital payment vendors ──
    for (const [name, vehicles] of CUSTOMERS) {
      let c = await one('SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name = ?', [LOC, name]);
      if (!c) {
        const [r] = await db.query(
          `INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, type, short_name,
             effective_start_date, effective_end_date, creation_date, created_by, updated_by)
           VALUES (?, ?, 'N', 0, 'Credit', ?, '2026-01-01', '9999-12-31', NOW(), 'video-demo', 'video-demo')`,
          [name, LOC, name.substring(0, 20)]);
        c = { creditlist_id: r.insertId };
      }
      for (const v of vehicles) {
        if (!(await one('SELECT vehicle_id FROM m_creditlist_vehicles WHERE creditlist_id = ? AND vehicle_number = ?', [c.creditlist_id, v]))) {
          await q(`INSERT INTO m_creditlist_vehicles (creditlist_id, vehicle_number, vehicle_type, effective_start_date, effective_end_date,
                     created_by, updated_by, creation_date)
                   VALUES (?, ?, 'TRUCK', '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`, [c.creditlist_id, v]);
        }
      }
    }
    // The UPI vendor was first called 'UPI QR'; it is PAYTM now (the Paytm reconciliation video).
    await q("UPDATE m_credit_list SET Company_Name = 'PAYTM', short_name = 'PAYTM' WHERE location_code = ? AND Company_Name = 'UPI QR'", [LOC]);
    for (const name of DIGITAL) {
      if (!(await one('SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name = ?', [LOC, name]))) {
        await q(`INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, type, short_name,
                   effective_start_date, effective_end_date, creation_date, created_by, updated_by)
                 VALUES (?, ?, 'Y', 0, 'Credit', ?, '2026-01-01', '9999-12-31', NOW(), 'video-demo', 'video-demo')`, [name, LOC, name]);
      }
    }

    // ── Bank accounts: the station's IOB account, and the SAP account the location trigger made ──
    let bank = await one('SELECT bank_id FROM m_bank WHERE location_code = ? AND account_number = ?', [LOC, BANK.account_number]);
    if (!bank) {
      const [r] = await db.query(
        `INSERT INTO m_bank (bank_name, bank_branch, account_number, ifsc_code, location_code, type, account_nickname, ledger_name,
           internal_flag, is_oil_company, active_flag, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Y', 'N', 'Y', 'video-demo', 'video-demo')`,
        [BANK.bank_name, BANK.bank_branch, BANK.account_number, BANK.ifsc_code, LOC, BANK.type, BANK.account_nickname, BANK.ledger_name]);
      bank = { bank_id: r.insertId };
    }
    const sap = await one("SELECT bank_id FROM m_bank WHERE location_code = ? AND is_oil_company = 'Y' ORDER BY bank_id LIMIT 1", [LOC]);
    if (!sap) throw new Error('DEMO has no oil company (SAP) account; the m_location trigger should have made one.');
    await q('UPDATE m_bank SET account_number = ?, account_nickname = ? WHERE bank_id = ?', [SAP.account_number, SAP.account_nickname, sap.bank_id]);

    // Account heads and per-bank Static ledgers, copied from the template location as onboarding does.
    await q(`INSERT INTO m_account_heads (location_code, account_head_name, account_head_type, allowed_entry_type, notes_required_flag,
               active_flag, effective_start_date, effective_end_date, created_by, updated_by, creation_date, updation_date)
             SELECT ?, ah.account_head_name, ah.account_head_type, ah.allowed_entry_type, ah.notes_required_flag,
               ah.active_flag, ah.effective_start_date, ah.effective_end_date, 'video-demo', 'video-demo', NOW(), NOW()
             FROM m_account_heads ah
             WHERE ah.location_code = ? AND ah.account_head_name <> '2T Oil'
               AND NOT EXISTS (SELECT 1 FROM m_account_heads x WHERE x.location_code = ? AND x.account_head_name = ah.account_head_name)`,
    [LOC, TEMPLATE_LOC, LOC]);
    await q('CALL init_sap_static_ledger_rules(?, ?)', [LOC, TEMPLATE_LOC]);
    await q('CALL init_internal_static_ledger_rules(?, ?)', [LOC, TEMPLATE_LOC]);

    // Who can appear on each account: customers and UPI/card vendors pay into the bank, the fleet card settles in SAP,
    // and the bank pays the oil company.
    const addRule = async (bankId, sourceType, externalId, entryType) => {
      if (await one('SELECT rule_id FROM m_ledger_rules WHERE location_code = ? AND bank_id = ? AND source_type = ? AND external_id = ?',
        [LOC, bankId, sourceType, externalId])) return;
      await q(`INSERT INTO m_ledger_rules (location_code, bank_id, source_type, external_id, allowed_entry_type, notes_required_flag,
                 allow_split_flag, applies_to_cashflow, effective_start_date, effective_end_date, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, 'N', 'N', 'N', '2026-01-01', '2400-01-01', 'video-demo', 'video-demo')`,
      [LOC, bankId, sourceType, externalId, entryType]);
    };
    const party = async (name) => (await one('SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name = ?', [LOC, name])).creditlist_id;
    for (const [name] of CUSTOMERS) await addRule(bank.bank_id, 'Credit', await party(name), 'CREDIT');
    for (const name of ['PAYTM', 'CARD SWIPE']) await addRule(bank.bank_id, 'Credit', await party(name), 'CREDIT');
    await addRule(sap.bank_id, 'Credit', await party('FLEET CARD'), 'CREDIT');
    await addRule(bank.bank_id, 'Bank', sap.bank_id, 'DEBIT');
    await addRule(sap.bank_id, 'Bank', bank.bank_id, 'CREDIT');

    // ── Lube distributor for the lube-invoice video (an earlier version used a made-up one) ──
    await q("DELETE FROM m_supplier WHERE location_code = ? AND supplier_name = 'ERODE LUBE DISTRIBUTORS' AND created_by = 'video-demo'", [LOC]);
    let lubeSupplier = await one('SELECT supplier_id FROM m_supplier WHERE location_code = ? AND supplier_name = ?', [LOC, LUBE_SUPPLIER.name]);
    if (!lubeSupplier) {
      const [r] = await db.query(`INSERT INTO m_supplier (supplier_name, supplier_short_name, gstin, location_code, effective_start_date, effective_end_date, created_by, updated_by)
               VALUES (?, ?, ?, ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo')`,
      [LUBE_SUPPLIER.name, LUBE_SUPPLIER.short, LUBE_SUPPLIER.gstin, LOC]);
      lubeSupplier = { supplier_id: r.insertId };
    }

    // ── Reset: fuel and lube purchase invoices from the upload videos, their PDFs and the product links learnt ──
    const locId = LOC; // t_tank_invoice.location_id holds the location CODE, not m_location.location_id
    const tankInv = (await q('SELECT id FROM t_tank_invoice WHERE location_id = ?', [locId])).map((r) => r.id);
    if (tankInv.length) {
      await q(`DELETE c FROM t_tank_invoice_charges c JOIN t_tank_invoice_dtl d ON d.id = c.invoice_dtl_id WHERE d.invoice_id IN (?)`, [tankInv]);
      await q('DELETE FROM t_tank_invoice_dtl WHERE invoice_id IN (?)', [tankInv]);
      await q('DELETE FROM t_tank_invoice WHERE location_id = ? AND id IN (?)', [locId, tankInv]);
    }
    const lubeInv = (await q('SELECT lubes_hdr_id FROM t_lubes_inv_hdr WHERE location_code = ?', [LOC])).map((r) => r.lubes_hdr_id);
    if (lubeInv.length) {
      await q('DELETE FROM t_lubes_inv_lines WHERE lubes_hdr_id IN (?)', [lubeInv]);
      await q('DELETE FROM t_lubes_inv_hdr WHERE location_code = ? AND lubes_hdr_id IN (?)', [LOC, lubeInv]);
    }
    await q("DELETE FROM t_document_store WHERE location_code = ? AND entity_type IN ('TANK_INVOICE', 'LUBE_INVOICE')", [LOC]);
    await q('DELETE FROM t_invoice_product_map WHERE location_code = ?', [LOC]);
    for (const [key, name] of LUBE_SKU_LINKS) {
      const p = await one('SELECT product_id FROM m_product WHERE location_code = ? AND product_name = ?', [LOC, name]);
      await q(`INSERT INTO t_invoice_product_map (location_code, supplier_id, invoice_product_name, product_id, conversion_factor)
               VALUES (?, ?, ?, ?, NULL)`, [LOC, lubeSupplier.supplier_id, key, p.product_id]);
    }

    // ── Reset: products added in a video (anything not in FUELS/LUBES), with their opening stock ──
    const keepProducts = [...FUELS.map(([n]) => n), ...LUBES.map(([n]) => n)];
    const extraProducts = (await q('SELECT product_id FROM m_product WHERE location_code = ? AND product_name NOT IN (?)', [LOC, keepProducts]))
      .map((r) => r.product_id);
    if (extraProducts.length) {
      await q('DELETE FROM t_lubes_stock_adjustment_history WHERE product_id IN (?)', [extraProducts]).catch(() => {});
      await q('DELETE FROM t_lubes_stock_adjustment WHERE location_code = ? AND product_id IN (?)', [LOC, extraProducts]);
      await q('DELETE FROM m_product WHERE location_code = ? AND product_id IN (?)', [LOC, extraProducts]);
    }

    // ── Portal login for SRI LAKSHMI TRANSPORTS (the customer-phone video), named as PetroMath names them ──
    const sl = await one("SELECT creditlist_id, Company_Name FROM m_credit_list WHERE location_code = ? AND Company_Name = 'SRI LAKSHMI TRANSPORTS'", [LOC]);
    const custUser = `${LOC}${sl.creditlist_id}`;
    const cu = await one('SELECT Person_id FROM m_persons WHERE User_Name = ?', [custUser]);
    if (cu) {
      await q("UPDATE m_persons SET Password = ?, Role = 'Customer', creditlist_id = ?, effective_end_date = '2099-12-31' WHERE Person_id = ?", [hash, sl.creditlist_id, cu.Person_id]);
    } else {
      await q(`INSERT INTO m_persons (Person_Name, User_Name, Password, Role, location_code, creditlist_id, effective_start_date, effective_end_date,
                 created_by, updated_by, creation_date)
               VALUES (?, ?, ?, 'Customer', ?, ?, '2026-01-01', '2099-12-31', 'video-demo', 'video-demo', NOW())`,
      [sl.Company_Name, custUser, hash, LOC, sl.creditlist_id]);
    }

    // ── Reset: customers added in a video (anything not in CUSTOMERS/DIGITAL), with their login and opening balance ──
    const keep = [...CUSTOMERS.map(([n]) => n), ...DIGITAL];
    const extra = (await q('SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name NOT IN (?)', [LOC, keep]))
      .map((r) => r.creditlist_id);
    if (extra.length) {
      const adj = (await q("SELECT adjustment_id FROM t_adjustments WHERE location_code = ? AND external_source = 'CUSTOMER' AND external_id IN (?)",
        [LOC, extra])).map((r) => r.adjustment_id);
      if (adj.length) {
        await q('DELETE FROM t_adjustments_history WHERE adjustment_id IN (?)', [adj]);
        await q('DELETE FROM t_adjustments WHERE adjustment_id IN (?)', [adj]);
      }
      await q("DELETE FROM m_persons WHERE location_code = ? AND Role = 'Customer' AND creditlist_id IN (?)", [LOC, extra]);
      await q("DELETE FROM m_ledger_rules WHERE location_code = ? AND source_type = 'Credit' AND external_id IN (?)", [LOC, extra]);
      await q("DELETE FROM gl_ledgers WHERE location_code = ? AND source_type = 'CREDIT' AND source_id IN (?)", [LOC, extra]);
      await q('DELETE FROM m_creditlist_vehicles WHERE creditlist_id IN (?)', [extra]);
      await q('DELETE FROM r_credit_open_bal WHERE creditlist_id IN (?)', [extra]);
      await q('DELETE FROM m_credit_list WHERE location_code = ? AND creditlist_id IN (?)', [LOC, extra]);
    }

    // ── Reset: uploaded bank/SAP statement lines (and the ledger suggestions learnt from them) ──
    const bankIds = (await q('SELECT bank_id FROM m_bank WHERE location_code = ?', [LOC])).map((r) => r.bank_id);
    let removedLines = 0;
    if (bankIds.length) {
      await q(`DELETE s FROM t_bank_transaction_splits s JOIN t_bank_transaction t ON t.t_bank_id = s.t_bank_id
               WHERE t.bank_id IN (?)`, [bankIds]);
      const [r] = await db.query('DELETE FROM t_bank_transaction WHERE bank_id IN (?)', [bankIds]);
      removedLines = r.affectedRows;
      await q('DELETE FROM t_bank_ledger_suggestion_cache WHERE bank_id IN (?)', [bankIds]).catch(() => {});
    }

    // ── Reset: delete every DEMO shift and what closing one wrote ──
    const ids = (await q('SELECT closing_id FROM t_closing WHERE location_code = ?', [LOC])).map((r) => r.closing_id);
    if (ids.length) {
      const tables = (await q(
        `SELECT c.TABLE_NAME AS t FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'closing_id' AND tb.TABLE_TYPE = 'BASE TABLE'
            AND c.TABLE_NAME <> 't_closing' AND (c.TABLE_NAME LIKE 't\\_%' OR c.TABLE_NAME LIKE 'r\\_%')`)).map((r) => r.t);
      for (const t of tables) await q(`DELETE FROM \`${t}\` WHERE closing_id IN (?)`, [ids]);
      await q('DELETE FROM t_closing WHERE location_code = ? AND closing_id IN (?)', [LOC, ids]);
    }
    const bills = (await q('SELECT day_bill_id FROM t_day_bill WHERE location_code = ?', [LOC])).map((r) => r.day_bill_id);
    if (bills.length) {
      await q(`DELETE i FROM t_day_bill_items i JOIN t_day_bill_header h ON h.header_id = i.header_id WHERE h.day_bill_id IN (?)`, [bills]);
      await q('DELETE FROM t_day_bill_header WHERE day_bill_id IN (?)', [bills]);
      await q('DELETE FROM t_day_bill WHERE location_code = ? AND day_bill_id IN (?)', [LOC, bills]);
    }
    // Receipts made from bank uploads ("Auto from Bank") have no closing_id, so clear them by location.
    for (const t of ['t_reopen_audit', 't_sales_deletions', 't_closing_deleted', 't_receipts', 't_receipts_deleted']) {
      await q(`DELETE FROM ${t} WHERE location_code = ?`, [LOC]);
    }

    const history = await seedHistory(q, one, mgr ? mgr.Person_id : (await one('SELECT Person_id FROM m_persons WHERE User_Name = ?', [userName])).Person_id);

    await q('CALL RefreshMenuCache()');
    console.log(`DEMO ready: login ${userName}, ${NOZZLES.length} nozzles, ${STAFF.length} cashiers, ${CUSTOMERS.length} credit customers; removed ${ids.length} old shift(s), ${removedLines} bank line(s); history: ${history}.`);
  } finally {
    await db.end();
  }
}

// Past closed shifts with credit bills, and customers' payments, from the 15th of the month before last up to
// 3 days ago, so the customer reports have something to show. A fixed random sequence keeps every run's figures
// the same for the same dates. Written straight to the tables (like a shift closed long ago). Meter readings are
// chained backwards from the nozzles' current openings, so the newest seeded shift closes exactly where the
// next real shift opens and the shift video's meters don't change.
async function seedHistory(q, one, closerId) {
  let seed = 471;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 2, 15));
  const end = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - 3)); // not the last 2 days: the Cashier Shift list shows those by default

  const cashiers = (await q("SELECT Person_id FROM m_persons WHERE location_code = ? AND Role = 'Cashier' ORDER BY Person_id", [LOC])).map((r) => r.Person_id);
  const products = {};
  for (const [name, price] of FUELS) products[name] = { id: (await one('SELECT product_id FROM m_product WHERE location_code = ? AND product_name = ?', [LOC, name])).product_id, price };
  const customers = [];
  for (const [name] of CUSTOMERS) {
    const c = await one('SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name = ?', [LOC, name]);
    const vehicles = await q('SELECT vehicle_id, vehicle_number FROM m_creditlist_vehicles WHERE creditlist_id = ?', [c.creditlist_id]);
    customers.push({ name, id: c.creditlist_id, vehicles, due: 0 });
  }
  // How often each customer fills: the transport companies most days, the school and the trader now and then.
  const weight = { 'SRI LAKSHMI TRANSPORTS': 0.85, 'KAVERI ROADWAYS': 0.5, 'GREEN VALLEY SCHOOL': 0.25, 'ERODE TEXTILE TRADERS': 0.2 };

  // Meter readings: litres per nozzle per day, then walk back from today's openings.
  let mseed = 9001;
  const mrnd = () => { mseed = (mseed * 1103515245 + 12345) % 2147483648; return mseed / 2147483648; };
  const LITRES = { 'MS-1': [700, 200], 'MS-2': [500, 150], 'HSD-1': [1100, 300], 'HSD-2': [900, 250], 'XP-1': [80, 40] };
  const price = Object.fromEntries(FUELS.map(([n, p]) => [n, p]));
  const pumps = [];
  for (const [code, product, , opening] of NOZZLES) {
    pumps.push({ code, product, id: (await one('SELECT pump_id FROM m_pump WHERE location_code = ? AND pump_code = ?', [LOC, code])).pump_id, opening });
  }
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));
  const readings = {}; // day -> [{pump_id, opening, closing, price}]
  const meter = Object.fromEntries(pumps.map((p) => [p.code, p.opening]));
  for (const day of [...days].reverse()) {
    readings[day] = pumps.map((p) => {
      const [avg, spread] = LITRES[p.code];
      const litres = Math.round((avg + (mrnd() * 2 - 1) * spread) * 100) / 100;
      const closing = meter[p.code];
      const opening = Math.round((closing - litres) * 1000) / 1000;
      meter[p.code] = opening;
      return { pump_id: p.id, opening, closing, price: price[p.product] };
    });
  }

  // Paytm: its own random sequence, so adding it didn't change the credit-statement figures.
  let pseed = 2026;
  const prnd = () => { pseed = (pseed * 1103515245 + 12345) % 2147483648; return pseed / 2147483648; };
  const paytm = (await one("SELECT creditlist_id FROM m_credit_list WHERE location_code = ? AND Company_Name = 'PAYTM'", [LOC])).creditlist_id;
  const paytmSales = [];

  let billNo = 1001;
  let receiptNo = 5001;
  let shifts = 0;
  let bills = 0;
  let receipts = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = ymd(d);
    const r = await q(
      `INSERT INTO t_closing (closer_id, cashier_id, location_code, cash, ex_short, closing_status, notes, closing_date, close_reading_time,
         created_by, updated_by, creation_date)
       VALUES (?, ?, ?, 2000, 0, 'CLOSED', 'video demo history', ?, '14:00:00', 'video-demo', 'video-demo', ?)`,
      [closerId, pick(cashiers), LOC, day, `${day} 08:30:00`]);
    const closingId = r.insertId;
    shifts++;
    for (const rd of readings[day]) {
      await q(`INSERT INTO t_reading (closing_id, pump_id, opening_reading, closing_reading, price, testing, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, 0, 'video-demo', 'video-demo')`, [closingId, rd.pump_id, rd.opening, rd.closing, rd.price]);
    }
    for (const c of customers) {
      if (rnd() > weight[c.name]) continue;
      const fills = c.name === 'SRI LAKSHMI TRANSPORTS' && rnd() < 0.4 ? 2 : 1;
      for (let i = 0; i < fills; i++) {
        const fuel = c.name === 'GREEN VALLEY SCHOOL' ? 'HSD' : (rnd() < 0.85 ? 'HSD' : 'MS');
        const qty = fuel === 'HSD' ? Math.round(60 + rnd() * 140) : Math.round(10 + rnd() * 30);
        const amount = Math.round(qty * products[fuel].price * 100) / 100;
        const v = c.vehicles.length ? pick(c.vehicles) : null;
        await q(`INSERT INTO t_credits (closing_id, bill_no, creditlist_id, vehicle_id, vehicle_number, product_id, price, price_discount, qty, amount,
                   credit_bill_date, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'video-demo', 'video-demo')`,
        [closingId, String(billNo++), c.id, v ? v.vehicle_id : null, v ? v.vehicle_number : null, products[fuel].id, products[fuel].price, qty, amount, day]);
        c.due += amount;
        bills++;
      }
    }
    // Payments by NEFT on the 5th and 20th: most of what is due, rounded down to the thousand.
    if (d.getUTCDate() === 5 || d.getUTCDate() === 20) {
      for (const c of customers) {
        const pay = Math.floor((c.due * (0.75 + rnd() * 0.2)) / 1000) * 1000;
        if (pay < 1000) continue;
        const ref = `NEFT-${String(Math.floor(rnd() * 1e10)).padStart(10, '0')}-${c.name.slice(0, 14)}`;
        await q(`INSERT INTO t_receipts (receipt_no, creditlist_id, receipt_type, amount, notes, receipt_date, location_code, created_by, updated_by)
                 VALUES (?, ?, 'Bank Deposit', ?, ?, ?, ?, 'video-demo', 'video-demo')`,
        [String(receiptNo++), c.id, pay, `Auto from Bank - ${ref}`, day, LOC]);
        c.due -= pay;
        receipts++;
      }
    }
    // Paytm collected in the shift (entered on the Digital Sales tab).
    const paytmAmt = Math.round((12000 + prnd() * 16000) * 100) / 100;
    await q(`INSERT INTO t_digital_sales (closing_id, vendor_id, amount, transaction_date, created_by, updated_by)
             VALUES (?, ?, ?, ?, 'video-demo', 'video-demo')`, [closingId, paytm, paytmAmt, day]);
    paytmSales.push({ day, dow: d.getUTCDay(), amount: paytmAmt });
  }

  // Paytm settles each day's collection to the bank the next day (auto-match looks back 1 day). In the month
  // before this one, two things the reconciliation video fixes by hand: one Thursday and Friday paid together
  // on Saturday, and one Wednesday's payment ₹47 short (a refund).
  const lastMonth = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  const firstFrom = (dom, dow) => {
    for (let d = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), dom)); ; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === dow) return ymd(d);
    }
  };
  const shortDay = firstFrom(10, 3); // first Wednesday from the 10th
  const heldDay = firstFrom(20, 4); // first Thursday from the 20th: paid with Friday's
  let pending = [];
  let settlements = 0;
  const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };
  for (const s of paytmSales) {
    pending.push(s);
    if (s.day === heldDay) continue;
    const total = Math.round(pending.reduce((a, p) => a + p.amount, 0) * 100) / 100;
    const payDay = addDays(s.day, 1);
    const amount = pending.some((p) => p.day === shortDay) ? Math.round((total - 47) * 100) / 100 : total;
    const ref = `NEFT-YESB${String(Math.floor(prnd() * 1e10)).padStart(10, '0')}-PAYTM PAYMENTS SERVICES LTD`;
    await q(`INSERT INTO t_receipts (receipt_no, creditlist_id, receipt_type, amount, notes, receipt_date, location_code, created_by, updated_by)
             VALUES (?, ?, 'Bank Deposit', ?, ?, ?, ?, 'video-demo', 'video-demo')`,
    [String(receiptNo++), paytm, amount, `Auto from Bank - ${ref}`, payDay, LOC]);
    settlements++;
    pending = [];
  }
  return `${shifts} closed shifts, ${bills} credit bills, ${receipts} receipts, ${paytmSales.length} Paytm sales / ${settlements} settlements (short ${shortDay}, held ${heldDay}) from ${ymd(start)}`;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
