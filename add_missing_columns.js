// add_missing_columns.js
// Safe migration: add any missing columns to registrations table
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'rpl.db');
if (!fs.existsSync(DB)) {
  console.error('rpl.db not found at', DB);
  process.exit(1);
}

// backup first
const BACKUP = path.join(__dirname, `rpl.db.bak.${Date.now()}`);
try {
  fs.copyFileSync(DB, BACKUP);
  console.log('Backup created:', BACKUP);
} catch (e) {
  console.error('Failed to create backup. Aborting.', e);
  process.exit(1);
}

const db = new sqlite3.Database(DB, (err) => {
  if (err) { console.error('Failed to open DB:', err); process.exit(1); }
});

function all(sql, params=[]) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));
}
function run(sql, params=[]) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err){
    if (err) reject(err); else resolve(this);
  }));
}

(async function main(){
  try {
    const info = await all(`PRAGMA table_info('registrations')`);
    const cols = info.map(r => r.name);
    console.log('Existing columns:', cols.join(', '));

    // columns we expect for the current server code
    const expected = {
      playerEmail: "TEXT",
      passport_photo: "TEXT",
      payment_screenshot: "TEXT",
      screenshot: "TEXT",
      aadhaar: "TEXT",
      teamName: "TEXT",
      jerseyNumber: "TEXT",
      jerseySize: "TEXT",
      category: "TEXT",
      payment_status: "TEXT DEFAULT 'pending'",
      created_at: "INTEGER"
    };

    for (const [col, def] of Object.entries(expected)) {
      if (!cols.includes(col)) {
        const sql = `ALTER TABLE registrations ADD COLUMN ${col} ${def}`;
        console.log('Adding column:', col);
        try {
          await run(sql);
          console.log('Added:', col);
        } catch (e) {
          console.error('Failed to add', col, e && e.message ? e.message : e);
        }
      } else {
        console.log('Already has column', col);
      }
    }

    const final = await all(`PRAGMA table_info('registrations')`);
    console.log('Final columns:', final.map(r => r.name).join(', '));
    console.log('Migration finished. If server is running, restart it now.');
    db.close();
  } catch (err) {
    console.error('Migration error:', err && (err.stack || err.message || err));
    db.close();
    process.exit(1);
  }
})();
