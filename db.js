// db.js — unified DB layer (Supabase if configured, otherwise SQLite fallback)
// NOTE: jerseyNumber, jerseySize, category removed.

const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY || '';

const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (useSupabase) {
  // Lazy-load so projects without @supabase/supabase-js still work with SQLite
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  module.exports = {
    async insertRegistration(rec) {
      const payload = {
        teamName: rec.teamName || null,
        playerName: rec.playerName || null,
        playerRole: rec.playerRole || null,
        playerMobile: rec.playerMobile || null,
        playerEmail: rec.playerEmail || null,
        screenshot: rec.screenshot || null,
        aadhaar: rec.aadhaar || null,
        passport_photo: rec.passport_photo || null,
        payment_screenshot: rec.payment_screenshot || null,
        payment_status: rec.payment_status || 'pending',
        created_at: rec.created_at ? Number(rec.created_at) : Math.floor(Date.now())
      };
      const { data, error } = await supa.from('registrations').insert(payload).select('id').single();
      if (error) throw error;
      return data.id;
    },

    async getAllRegistrations() {
      const { data, error } = await supa.from('registrations').select('*').order('id', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async getRegistrationById(id) {
      const { data, error } = await supa.from('registrations').select('*').eq('id', id).single();
      if (error) {
        // treat "no rows" as not found, otherwise throw
        if (error.code && (error.code === 'PGRST116' || error.message?.includes('No rows found'))) return null;
        throw error;
      }
      return data || null;
    },

    async markPaymentVerified(id) {
      const { error } = await supa.from('registrations').update({ payment_status: 'verified' }).eq('id', id);
      if (error) throw error;
    },

    async markPaymentRejected(id) {
      const { error } = await supa.from('registrations').update({ payment_status: 'rejected' }).eq('id', id);
      if (error) throw error;
    },

    async deleteRegistration(id) {
      const { error } = await supa.from('registrations').delete().eq('id', id);
      if (error) throw error;
    }
  };

} else {
  // SQLite fallback
  const sqlite3 = require('sqlite3').verbose();
  const DB_PATH = path.join(__dirname, 'rpl.db');

  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Failed to open DB:', err);
      process.exit(1);
    }
  });

  // ensure table exists (without jerseyNumber / jerseySize / category)
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS registrations (
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
      )
    `, (err) => {
      if (err) console.error('Create table error:', err);
    });
  });

  module.exports = {
    insertRegistration(rec) {
      return new Promise((resolve, reject) => {
        const stmt = `
          INSERT INTO registrations (
            teamName, playerName, playerMobile, playerEmail, playerRole,
            screenshot, aadhaar, passport_photo, payment_screenshot,
            payment_status, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `;
        const params = [
          rec.teamName || null,
          rec.playerName || null,
          rec.playerMobile || null,
          rec.playerEmail || null,
          rec.playerRole || null,
          rec.screenshot || null,
          rec.aadhaar || null,
          rec.passport_photo || null,
          rec.payment_screenshot || null,
          rec.payment_status || 'pending',
          rec.created_at ? Number(rec.created_at) : Math.floor(Date.now())
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
}
