// E:\rpl\db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const DB_PATH = path.join(__dirname, "rpl.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to open DB:", err);
    process.exit(1);
  }
});

// Ensure table exists with all expected columns
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamName TEXT,
      playerName TEXT,
      playerMobile TEXT,
      playerEmail TEXT,
      playerRole TEXT,
      jerseyNumber TEXT,
      jerseySize TEXT,
      category TEXT,
      screenshot TEXT,
      aadhaar TEXT,
      passport_photo TEXT,
      payment_screenshot TEXT,
      payment_status TEXT DEFAULT 'pending',
      created_at INTEGER
    )
  `, (err) => {
    if (err) console.error("Create table error:", err);
  });
});

module.exports = {
  insertRegistration(rec) {
    return new Promise((resolve, reject) => {
      const stmt = `
        INSERT INTO registrations (
          teamName, playerName, playerMobile, playerEmail, playerRole,
          jerseyNumber, jerseySize, category,
          screenshot, aadhaar, passport_photo, payment_screenshot,
          payment_status, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `;
      const params = [
        rec.teamName || null,
        rec.playerName || null,
        rec.playerMobile || null,
        rec.playerEmail || null,
        rec.playerRole || null,
        rec.jerseyNumber || null,
        rec.jerseySize || null,
        rec.category || null,
        rec.screenshot || null,
        rec.aadhaar || null,
        rec.passport_photo || null,
        rec.payment_screenshot || null,
        rec.payment_status || 'pending',
        rec.created_at || Date.now()
      ];
      db.run(stmt, params, function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      });
    });
  },

  getAllRegistrations() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM registrations ORDER BY id DESC`, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  getRegistrationById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM registrations WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  },

  markPaymentVerified(id) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE registrations SET payment_status = 'verified' WHERE id = ?`, [id], function (err) {
        if (err) return reject(err);
        resolve();
      });
    });
  },

  markPaymentRejected(id) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE registrations SET payment_status = 'rejected' WHERE id = ?`, [id], function (err) {
        if (err) return reject(err);
        resolve();
      });
    });
  },

  deleteRegistration(id) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM registrations WHERE id = ?`, [id], function (err) {
        if (err) return reject(err);
        resolve();
      });
    });
  }
};
