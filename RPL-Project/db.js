// db.js - simple sqlite3 wrapper (promisified)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, 'rpl.db');

const db = new sqlite3.Database(DB_PATH, err => {
  if (err) {
    console.error('Failed to open DB:', err);
    process.exit(1);
  }
});

// Ensure table exists (safe)
const schema = `
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teamName TEXT,
  playerName TEXT,
  playerRole TEXT,
  playerMobile TEXT,
  playerEmail TEXT,
  jerseyNumber TEXT,
  jerseySize TEXT,
  category TEXT,
  screenshot TEXT,
  aadhaar TEXT,
  passport_photo TEXT,
  payment_screenshot TEXT,
  payment_status TEXT DEFAULT 'pending',
  created_at INTEGER
);
`;
db.exec(schema, (err) => {
  if (err) console.error('Schema create error', err);
});

function runAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function insertRegistration(rec) {
  const sql = `INSERT INTO registrations
    (teamName, playerName, playerRole, playerMobile, playerEmail, jerseyNumber, jerseySize, category, screenshot, aadhaar, passport_photo, payment_screenshot, payment_status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const params = [
    rec.teamName || null, rec.playerName || null, rec.playerRole || null, rec.playerMobile || null, rec.playerEmail || null,
    rec.jerseyNumber || null, rec.jerseySize || null, rec.category || null, rec.screenshot || null, rec.aadhaar || null,
    rec.passport_photo || null, rec.payment_screenshot || null, rec.payment_status || 'pending', rec.created_at || Date.now()
  ];
  const r = await runAsync(sql, params);
  return r.lastID;
}

async function getAllRegistrations() {
  return allAsync(`SELECT * FROM registrations ORDER BY id DESC`);
}

async function getRegistrationById(id) {
  return getAsync(`SELECT * FROM registrations WHERE id = ?`, [id]);
}

async function markPaymentVerified(id) {
  return runAsync(`UPDATE registrations SET payment_status = 'verified' WHERE id = ?`, [id]);
}
async function markPaymentRejected(id) {
  return runAsync(`UPDATE registrations SET payment_status = 'rejected' WHERE id = ?`, [id]);
}
async function deleteRegistration(id) {
  return runAsync(`DELETE FROM registrations WHERE id = ?`, [id]);
}

module.exports = {
  insertRegistration,
  getAllRegistrations,
  getRegistrationById,
  markPaymentVerified,
  markPaymentRejected,
  deleteRegistration
};
