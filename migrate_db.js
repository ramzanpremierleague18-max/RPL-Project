// migrate_db.js
// Safe migration: add any missing columns to registrations table
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, 'rpl.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open DB:', err);
    process.exit(1);
  }
});

function getColumns() {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info('registrations')`, [], (err, rows) => {
      if (err) return reject(err);
      const cols = rows.map(r => r.name);
      resolve(cols);
    });
  });
}

async function run() {
  try {
    const cols = await getColumns();
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
        await new Promise((resolve, reject) => {
          db.run(sql, [], function(err) {
            if (err) {
              console.error('Failed to add column', col, err);
              return reject(err);
            }
            console.log('Added column', col);
            resolve();
          });
        });
      } else {
        console.log('Already has column', col);
      }
    }

    console.log('Migration complete.');
    db.close();
  } catch (err) {
    console.error('Migration error:', err && (err.stack || err.message || err));
    db.close();
    process.exit(1);
  }
}

run();
