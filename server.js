// server.js — Full working server (cookie admin login, QR, uploads, email non-fatal)
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cookieParser = require('cookie-parser'); // <-- ensure package installed
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ---------- ADMIN CREDENTIALS ----------
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').toString();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'password').toString();
const SESSION_MS = Number(process.env.ADMIN_SESSION_MS || 2 * 60 * 60 * 1000); // 2 hours

// ---------- MAILER (optional) ----------
let mailer = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log('Mailer configured as', process.env.SMTP_USER);
} else {
  console.log('Mailer not configured — emails will be skipped (set SMTP_USER & SMTP_PASS in .env).');
}

// ---------- Express setup ----------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser()); // <-- required
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Uploads folder ----------
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const uniq = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = (file.fieldname || 'file').replace(/[^a-z0-9-_]/gi, '') + '-' + uniq;
    cb(null, safe + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// ---------- In-memory sessions ----------
const sessions = {};
function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + SESSION_MS;
  sessions[token] = { user: username, expires };
  return { token, expires };
}
function isSessionValid(token) {
  if (!token) return false;
  const s = sessions[token];
  if (!s) return false;
  if (s.expires < Date.now()) { delete sessions[token]; return false; }
  return true;
}
function clearSession(token) { if (token && sessions[token]) delete sessions[token]; }

// ---------- Admin auth (cookie-first, fallback Basic) ----------
function adminAuth(req, res, next) {
  try {
    const tok = req.cookies?.admin_token;
    if (tok && isSessionValid(tok)) return next();

    // fallback to Basic header for compatibility
    const header = req.headers['authorization'];
    if (header && typeof header === 'string') {
      const m = header.match(/^Basic\s+(.+)$/i);
      if (m && m[1]) {
        const decoded = Buffer.from(m[1], 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx !== -1) {
          const user = decoded.slice(0, idx);
          const pass = decoded.slice(idx + 1);
          if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
        }
      }
    }

    return res.status(401).json({ error: 'auth_required' });
  } catch (err) {
    console.error('adminAuth error', err);
    return res.status(500).json({ error: 'auth_error' });
  }
}

// ---------- QR endpoints ----------
app.get('/qr', async (req, res) => {
  try {
    const upi = (process.env.FIXED_UPI || '').trim();
    const amount = (process.env.FIXED_AMOUNT || '499').toString();
    if (!upi) return res.status(200).send('/images/qr-default.jpg');
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&am=${encodeURIComponent(amount)}&tn=${encodeURIComponent('RPL Registration')}&cu=INR`;
    const dataUrl = await QRCode.toDataURL(uri, { width: 800 });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(dataUrl);
  } catch (err) {
    console.error('QR generation failed', err);
    return res.status(500).send('/images/qr-default.jpg');
  }
});

app.get('/qr.png', async (req, res) => {
  try {
    const upi = (process.env.FIXED_UPI || '').trim();
    const amount = (process.env.FIXED_AMOUNT || '499').toString();
    if (!upi) return res.status(400).send('UPI not configured');
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&am=${encodeURIComponent(amount)}&tn=${encodeURIComponent('RPL Registration')}&cu=INR`;
    const buffer = await QRCode.toBuffer(uri, { type: 'png', width: 800 });
    res.setHeader('Content-Type', 'image/png');
    return res.send(buffer);
  } catch (err) {
    console.error('QR png failed', err);
    return res.status(500).send('QR generation failed');
  }
});

// ---------- Serve uploads (admin only) ----------
app.get('/uploads/:fname', adminAuth, (req, res) => {
  const fname = path.basename(req.params.fname);
  const full = path.join(UPLOADS_DIR, fname);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
});

// ---------- Save registration ----------
app.post('/save-registration', upload.fields([
  { name: 'payment_screenshot', maxCount: 1 },
  { name: 'passport_photo', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('--- /save-registration called ---');
    console.log('body keys:', Object.keys(req.body || {}));
    console.log('files keys:', Object.keys(req.files || {}));

    const playerName = (req.body.playerName || '').trim();
    const playerMobile = (req.body.playerMobile || '').trim();
    const playerEmail = (req.body.playerEmail || '').trim();
    const playerRole = (req.body.playerRole || '').trim();

    if (!playerName || !playerMobile || !playerEmail || !playerRole) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!req.files || !req.files.payment_screenshot || !req.files.passport_photo) {
      return res.status(400).json({ error: 'payment_screenshot and passport_photo required' });
    }

    const rec = {
      teamName: null,
      playerName,
      playerMobile,
      playerEmail,
      playerRole,
      jerseyNumber: null,
      jerseySize: null,
      category: null,
      screenshot: null,
      aadhaar: null,
      passport_photo: '/uploads/' + req.files.passport_photo[0].filename,
      payment_screenshot: '/uploads/' + req.files.payment_screenshot[0].filename,
      payment_status: 'pending',
      created_at: Date.now()
    };

    const id = await db.insertRegistration(rec);
    console.log('Saved reg id=', id, 'name=', playerName);
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('SAVE REG ERROR', err && (err.stack || err.message || err));
    return res.status(500).json({ error: 'save_failed', detail: String(err && err.message) });
  }
});

// ---------- Admin login/logout/status ----------
app.post('/admin/login', (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.status(400).json({ error: 'missing_credentials' });
    if (String(user) === ADMIN_USER && String(pass) === ADMIN_PASS) {
      const s = createSession(user);
      res.cookie('admin_token', s.token, { httpOnly: true, maxAge: SESSION_MS });
      return res.json({ ok: true, expires: s.expires });
    }
    return res.status(401).json({ error: 'invalid_credentials' });
  } catch (err) {
    console.error('login err', err);
    return res.status(500).json({ error: 'login_failed' });
  }
});

app.post('/admin/logout', adminAuth, (req, res) => {
  try {
    const tok = req.cookies?.admin_token;
    if (tok) clearSession(tok);
    res.clearCookie('admin_token');
    return res.json({ ok: true });
  } catch (err) {
    console.error('logout err', err);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

app.get('/admin/status', (req, res) => {
  try {
    const tok = req.cookies?.admin_token;
    return res.json({ ok: true, loggedIn: tok && isSessionValid(tok) ? true : false });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

// ---------- Admin: list registrations ----------
app.get('/registrations', adminAuth, async (req, res) => {
  try {
    const rows = await db.getAllRegistrations();
    return res.json(rows);
  } catch (err) {
    console.error('get regs err', err);
    return res.status(500).json({ error: 'db_failed' });
  }
});

// ---------- Admin: verify (non-fatal email) ----------
app.post('/admin/verify/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await db.markPaymentVerified(id);
    const row = await db.getRegistrationById(id);

    if (mailer && row && row.playerEmail) {
      try {
        await mailer.sendMail({
          from: `"RPL Management" <${process.env.SMTP_USER}>`,
          to: row.playerEmail,
          subject: 'RPL Registration Verified',
          text: `Hi ${row.playerName},

✔ Payment confirmed  
✔ Player details verified  
✔ You are officially selected for the tournament

Selected team will contact you shortly with match schedules and further updates.

Play well and all the best! 🏏🔥

Regards,
Noor ali & RPL Management Team`
        });
        console.log('Email sent to', row.playerEmail);
        return res.json({ ok: true, email: 'sent' });
      } catch (mailErr) {
        console.warn('EMAIL failed (non-fatal):', String(mailErr && (mailErr.message || mailErr)));
        return res.json({ ok: true, email: 'failed', error: String(mailErr && (mailErr.message || mailErr)) });
      }
    }

    return res.json({ ok: true, email: 'skipped' });
  } catch (err) {
    console.error('verify err', err && (err.stack || err.message || err));
    return res.status(500).json({ error: 'verify_failed', detail: String(err && err.message) });
  }
});

// ---------- Admin: reject & delete ----------
app.post('/admin/reject/:id', adminAuth, async (req, res) => {
  try {
    await db.markPaymentRejected(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('reject err', err);
    return res.status(500).json({ error: 'reject_failed' });
  }
});

app.post('/admin/delete/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const row = await db.getRegistrationById(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    ['payment_screenshot', 'passport_photo', 'screenshot', 'aadhaar'].forEach(k => {
      if (row[k]) {
        const fp = path.join(UPLOADS_DIR, path.basename(row[k]));
        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) { console.warn('unlink err', fp, e); }
      }
    });

    await db.deleteRegistration(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete err', err);
    return res.status(500).json({ error: 'delete_failed' });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
