// migrate_remove_jersey.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'rpl.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('rpl.db not found at', DB_PATH);
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

function all(sql, params=[]) {
  return new Promise((resolve, reject) => db.all(sql, params, (e,r) => e ? reject(e) : resolve(r)));
}
function run(sql, params=[]) {
  return new Promise((resolve, reject) => db.run(sql, params, function(e){ if(e) reject(e); else resolve(this); }));
}

(async () => {
  try {
    const cols = await all(`PRAGMA table_info('registrations')`);
    console.log('Current columns:', cols.map(c => c.name).join(', '));

    // If jerseyNumber etc not present, nothing to do
    const names = cols.map(c => c.name);
    const toRemove = ['jerseyNumber','jerseySize','category'].filter(c => names.includes(c));
    if (!toRemove.length) {
      console.log('No jersey/category columns found — migration not needed.');
      db.close();
      return;
    }

    await run('BEGIN TRANSACTION;');

    await run(`
      CREATE TABLE registrations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teamName TEXT,
        playerName TEXT,
        playerMobile TEXT,
        playerEmail TEXT,
        playerRole TEXT,
        screenshot TEXT,
        aadhaar TEXT,
        passport_photo TEXT,
        payment_screenshot TEXT,
        payment_status TEXT DEFAULT 'pending',
        created_at INTEGER
      );
    `);

    await run(`
      INSERT INTO registrations_new (id, teamName, playerName, playerMobile, playerEmail, playerRole, screenshot, aadhaar, passport_photo, payment_screenshot, payment_status, created_at)
      SELECT id,
             COALESCE(teamName,NULL),
             COALESCE(playerName,NULL),
             COALESCE(playerMobile,NULL),
             COALESCE(playerEmail,NULL),
             COALESCE(playerRole,NULL),
             COALESCE(screenshot,NULL),
             COALESCE(aadhaar,NULL),
             COALESCE(passport_photo,NULL),
             COALESCE(payment_screenshot,NULL),
             COALESCE(payment_status,'pending'),
             COALESCE(created_at, strftime('%s','now'))
      FROM registrations;
    `);

    await run(`DROP TABLE registrations;`);
    await run(`ALTER TABLE registrations_new RENAME TO registrations;`);
    await run('COMMIT;');

    const newCols = await all(`PRAGMA table_info('registrations')`);
    console.log('Migration complete. New columns:', newCols.map(c => c.name).join(', '));
    db.close();
  } catch (err) {
    console.error('Migration failed:', err && (err.stack || err.message || err));
    try { await run('ROLLBACK;'); } catch(e) {}
    db.close();
    process.exit(1);
  }
})();
