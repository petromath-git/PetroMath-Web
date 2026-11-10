// Admin login at the beta training station (ticket #471): beta MUE is renamed "DEMO FUEL STATION (TRAINING)" by the
// beta refresh, so videos that need a full year of real-looking books (accounting) are recorded there instead of DEMO.
// Creates or resets the login TRAINING_USER (default TRAINING-OWNER, shown as DEMO OWNER) with DEMO_PASSWORD.
// BETA DB only. Usage: node training-login.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const PROD_HOSTS = ['13.205.41.114'];
const PROD_TUNNEL_PORT = 33307;

async function main() {
  const host = process.env.BETA_DB_HOST;
  const port = Number(process.env.BETA_DB_PORT);
  if (PROD_HOSTS.includes(host) || port === PROD_TUNNEL_PORT) throw new Error('This points at the PROD database. Training logins live on beta only.');
  if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 10) throw new Error('Set DEMO_PASSWORD (10+ characters) in tools/videos/.env');
  const loc = process.env.TRAINING_LOC || 'MUE';
  const user = process.env.TRAINING_USER || 'TRAINING-OWNER';

  const db = await mysql.createConnection({
    host, port, user: process.env.BETA_DB_USER, password: process.env.BETA_DB_PASSWORD, database: process.env.BETA_DB_NAME, dateStrings: true,
  });
  try {
    const [[l]] = await db.query('SELECT location_name FROM m_location WHERE location_code = ?', [loc]);
    if (!l) throw new Error(`No location ${loc} on this database`);
    if (!/DEMO|TRAINING/i.test(l.location_name)) throw new Error(`${loc} is named "${l.location_name}" here: not the masked training copy`);

    const hash = await bcrypt.hash(process.env.DEMO_PASSWORD, 12);
    const [[p]] = await db.query('SELECT Person_id, location_code FROM m_persons WHERE User_Name = ?', [user]);
    if (p && p.location_code !== loc) throw new Error(`User name ${user} already belongs to ${p.location_code}`);
    if (p) {
      await db.query("UPDATE m_persons SET Person_Name = 'DEMO OWNER', Password = ?, Role = 'Admin', effective_end_date = '9999-12-31' WHERE Person_id = ?", [hash, p.Person_id]);
    } else {
      await db.query(`INSERT INTO m_persons (Person_Name, User_Name, Password, Role, location_code, effective_start_date, effective_end_date,
                        created_by, updated_by, creation_date)
                      VALUES ('DEMO OWNER', ?, ?, 'Admin', ?, '2026-01-01', '9999-12-31', 'video-demo', 'video-demo', NOW())`, [user, hash, loc]);
    }
    console.log(`Login ${user} (Admin) ready at ${loc} "${l.location_name}"`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
