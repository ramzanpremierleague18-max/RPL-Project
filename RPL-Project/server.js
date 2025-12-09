// server.js - RPL registration server (complete)
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// single admin account (from .env)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';

// basic auth middleware (simple)
function basicAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }
  const m = auth.match(/^Basic\s+(.+)$/i);
  if (!m) return res.status(401).send('Invalid auth header');
  const creds = Buffer.from(m[1], 'base64').toString('utf8');
  const idx = creds.indexOf(':');
  if (idx === -1) return res.status(401).send('Invalid auth header');
  const user = creds.slice(0, idx);
  const pass = creds.slice(idx + 1);
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(403).send('Forbidden');
}

// Mailer (optional) - use SMTP_* env vars
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
  console.log('Mailer not configured - set SMTP_USER and SMTP_PASS in .env to enable emails.');
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// create uploads dir if missing
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// multer config
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (/image\/|pdf/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images or PDF allowed'));
  }
});

/* ---------- QR endpoints ---------- */
// data URL (text response) - good for <img src="...">
app.get('/qr', async (req, res) => {
  try {
    const upi = (req.query.upi || process.env.FIXED_UPI || '').trim();
    const amount = (req.query.amount || process.env.FIXED_AMOUNT || '499').toString();
    if (!upi) return res.status(200).send('/images/qr-default.jpg');
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&am=${encodeURIComponent(amount)}&tn=${encodeURIComponent('RPL Registration')}&cu=INR`;
    const dataUrl = await QRCode.toDataURL(uri, { width: 800 });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(dataUrl);
  } catch (err) {
    console.error('QR generation (dataUrl) failed', err);
    return res.status(500).send('/images/qr-default.jpg');
  }
});

// PNG binary
app.get('/qr.png', async (req, res) => {
  try {
    const upi = (req.query.upi || process.env.FIXED_UPI || '').trim();
    const amount = (req.query.amount || process.env.FIXED_AMOUNT || '499').toString();
    if (!upi) return res.status(400).send('UPI not configured');
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&am=${encodeURIComponent(amount)}&tn=${encodeURIComponent('RPL Registration')}&cu=INR`;
    const buffer = await QRCode.toBuffer(uri, { type: 'png', width: 800 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('QR generation (png) failed', err);
    return res.status(500).send('QR generation failed');
  }
});

/* ---------- Serve uploaded files (admin only) ---------- */
app.get('/uploads/:fname', basicAuth, (req, res) => {
  const fname = path.basename(req.params.fname);
  const full = path.join(UPLOADS_DIR, fname);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
});

/* ---------- Save registration ---------- */
app.post('/save-registration', upload.fields([
  { name: 'payment_screenshot', maxCount: 1 },
  { name: 'passport_photo', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('--- /save-registration called ---');
    console.log('body keys:', Object.keys(req.body));
    console.log('files keys:', Object.keys(req.files || {}));

    const playerName = (req.body.playerName || '').trim();
    const playerMobile = (req.body.playerMobile || '').trim();
    const playerEmail = (req.body.playerEmail || '').trim();
    const playerRole = (req.body.playerRole || '').trim();

    if (!playerName || !playerMobile || !playerEmail || !playerRole) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!req.files || !req.files.payment_screenshot || !req.files.passport_photo) {
      return res.status(400).json({ error: 'Both payment_screenshot and passport_photo are required' });
    }

    const paymentFile = req.files.payment_screenshot[0];
    const passportFile = req.files.passport_photo[0];

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
      passport_photo: '/uploads/' + passportFile.filename,
      payment_screenshot: '/uploads/' + paymentFile.filename,
      payment_status: 'pending',
      created_at: Date.now()
    };

    const id = await db.insertRegistration(rec);
    console.log('Saved registration id=', id, 'name=', playerName);
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('SAVE REGISTRATION ERROR:', err && (err.stack || err.message || err));
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'file_too_large' });
    }
    return res.status(500).json({ error: 'save_failed', detail: String(err && err.message) });
  }
});

/* ---------- Admin routes ---------- */
// list - protected
app.get('/registrations', basicAuth, async (req, res) => {
  try {
    const rows = await db.getAllRegistrations();
    res.json(rows);
  } catch (err) {
    console.error('get registrations error', err);
    res.status(500).json({ error: 'db_failed' });
  }
});

// verify - protected; attempt email but never fail verification on SMTP error
app.post('/admin/verify/:id', basicAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await db.markPaymentVerified(id);
    const row = await db.getRegistrationById(id);

    if (mailer && row && row.playerEmail) {
      const mail = {
        from: `"RPL Management" <${process.env.SMTP_USER}>`,
        to: row.playerEmail,
        subject: 'RPL Registration Verified',
        text: `Hi ${row.playerName},\n\nYour registration for RPL has been VERIFIED. Payment and details confirmed.\n\nRegards,\nRPL Management`
      };
      try {
        await mailer.sendMail(mail);
        console.log('Email sent to', row.playerEmail);
        return res.json({ ok: true, email: 'sent' });
      } catch (mailErr) {
        console.warn('Email send failed (non-fatal):', mailErr && (mailErr.message || mailErr));
        return res.json({ ok: true, email: 'failed', error: String(mailErr && mailErr.message) });
      }
    }

    return res.json({ ok: true, email: 'skipped' });
  } catch (err) {
    console.error('verify error', err && (err.stack || err.message || err));
    return res.status(500).json({ error: 'verify_failed', detail: String(err && err.message) });
  }
});

// reject
app.post('/admin/reject/:id', basicAuth, async (req, res) => {
  try {
    await db.markPaymentRejected(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('reject error', err);
    res.status(500).json({ error: 'reject_failed' });
  }
});

// delete (and remove files)
app.post('/admin/delete/:id', basicAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const row = await db.getRegistrationById(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    ['payment_screenshot','passport_photo','screenshot','aadhaar'].forEach(k => {
      if (row[k]) {
        const bn = path.basename(row[k]);
        const fp = path.join(UPLOADS_DIR, bn);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { console.warn('unlink failed', fp, e); }
      }
    });

    await db.deleteRegistration(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete error', err);
    res.status(500).json({ error: 'delete_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
