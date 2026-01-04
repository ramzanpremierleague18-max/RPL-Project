// server.js — FULL Production Server (Supabase + Cloudinary + Admin + QR + Mail + Excel Export)
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const cors = require('cors');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const cloudinary = require('cloudinary').v2;
const ExcelJS = require('exceljs');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

/* ---------------- CLOUDINARY ---------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ---------------- ADMIN CONFIG ---------------- */
const ADMIN_USER = String(process.env.ADMIN_USER || 'admin');
const ADMIN_PASS = String(process.env.ADMIN_PASS || 'password');
const SESSION_MS = 2 * 60 * 60 * 1000;

/* ---------------- MAILER (OPTIONAL) ---------------- */
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
}

/* ---------------- VERIFY EMAIL HELPER ---------------- */
async function sendVerifyEmail(to, name, id) {
  if (!mailer || !to) return;

  await mailer.sendMail({
    from: `"RPL Tournament" <${process.env.SMTP_USER}>`,
    to,
    subject: "RPL Registration Verified ✅",
    html: `
      <h2>Hello ${name}</h2>
      <p>Your RPL registration has been <b>VERIFIED</b>.</p>
      <p><b>Registration ID:</b> ${id}</p>
      <p>Please be ready for match day.</p>
      <br>
      <p>– RPL Admin Team</p>
    `
  });
}


/* ---------------- EXPRESS ---------------- */
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

/* ---------------- MULTER (MEMORY) ---------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

/* ---------------- ADMIN SESSIONS ---------------- */
const sessions = {};

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { user, expires: Date.now() + SESSION_MS };
  return token;
}

function isSessionValid(token) {
  return token && sessions[token] && sessions[token].expires > Date.now();
}

function clearSession(token) {
  if (token) delete sessions[token];
}

/* ---------------- ADMIN AUTH ---------------- */
function adminAuth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (isSessionValid(token)) return next();

  const h = req.headers.authorization;
  if (h?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(h.split(' ')[1], 'base64').toString().split(':');
    if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  }

  return res.status(401).json({ error: 'auth_required' });
}

/* ---------------- QR ---------------- */
app.get('/qr', async (req, res) => {
  try {
    // 🔒 HARD-CODED UPI (Tousif)
    const upi = 'tousieefullakhan@okicici';
    const amt = '300';

    const uri = `upi://pay?pa=${upi}&am=${amt}&cu=INR`;
    const data = await QRCode.toDataURL(uri, { width: 800 });

    res.send(data);
  } catch (err) {
    console.error('QR error:', err);
    res.status(500).send('/images/qr-default.jpg');
  }
});


app.get('/qr.png', async (req, res) => {
  const uri = `upi://pay?pa=${process.env.FIXED_UPI}&am=${process.env.FIXED_AMOUNT || '499'}&cu=INR`;
  const buf = await QRCode.toBuffer(uri, { width: 800 });
  res.type('png').send(buf);
});

/* ---------------- CLOUDINARY UPLOAD ---------------- */
function uploadToCloudinary(file, folder) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    ).end(file.buffer);
  });
}

/* ---------------- SAVE REGISTRATION ---------------- */
app.post('/save-registration',
  upload.fields([
    { name: 'payment_screenshot', maxCount: 1 },
    { name: 'passport_photo', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
    const { playerName, playerMobile, playerEmail, playerRole } = req.body;

// ❗ Email is OPTIONAL now
if (!playerName || !playerMobile || !playerRole) {
  return res.status(400).json({ error: 'missing_fields' });
}
      const pay = req.files?.payment_screenshot?.[0];
      const pass = req.files?.passport_photo?.[0];
      if (!pay || !pass) {
        return res.status(400).json({ error: 'files_required' });
      }

      const paymentUrl = await uploadToCloudinary(pay, 'rpl/payment');
      const passportUrl = await uploadToCloudinary(pass, 'rpl/player');

      const id = await db.insertRegistration({
        playerName,
        playerMobile,
        playerEmail,
        playerRole,
        payment_screenshot: paymentUrl,
        passport_photo: passportUrl,
        payment_status: 'pending',
        created_at: Date.now()
      });

      res.json({ ok: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'save_failed' });
    }
  }
);

/* ---------------- ADMIN LOGIN ---------------- */
app.post('/admin/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const token = createSession(user);
    res.cookie('admin_token', token, { httpOnly: true, maxAge: SESSION_MS });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'invalid_credentials' });
});

app.post('/admin/logout', adminAuth, (req, res) => {
  clearSession(req.cookies.admin_token);
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

/* ---------------- ADMIN DATA ---------------- */
app.get('/registrations', adminAuth, async (req, res) => {
  res.json(await db.getAllRegistrations());
});

/* ---------------- EXCEL EXPORT ---------------- */
app.get('/admin/export', adminAuth, async (req, res) => {
  try {
    const rows = await db.getAllRegistrations();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('RPL Players');

    ws.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Name', key: 'playerName', width: 25 },
      { header: 'Mobile', key: 'playerMobile', width: 18 },
      { header: 'Email', key: 'playerEmail', width: 30 },
      { header: 'Role', key: 'playerRole', width: 15 },
      { header: 'Status', key: 'payment_status', width: 15 },
      { header: 'Player Photo', key: 'passport_photo', width: 45 },
      { header: 'Payment Screenshot', key: 'payment_screenshot', width: 45 },
      { header: 'Registered At', key: 'created_at', width: 22 }
    ];

    rows.forEach(r => {
      ws.addRow({
        ...r,
        created_at: new Date(r.created_at).toLocaleString()
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=RPL_Players.xlsx'
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('Excel export error', e);
    res.status(500).json({ error: 'export_failed' });
  }
});

/* ---------------- VERIFY / REJECT / DELETE ---------------- */
app.post('/admin/verify/:id', adminAuth, async (req, res) => {
  const id = req.params.id;

  const player = await db.getRegistrationById(id);
  await db.markPaymentVerified(id);

  if (player?.playerEmail) {
    try {
      await sendVerifyEmail(
        player.playerEmail,
        player.playerName,
        id
      );
    } catch (e) {
      console.error('Email failed (non-fatal)', e);
    }
  }

  res.json({ ok: true });
});


app.post('/admin/reject/:id', adminAuth, async (req, res) => {
  await db.markPaymentRejected(req.params.id);
  res.json({ ok: true });
});

app.post('/admin/delete/:id', adminAuth, async (req, res) => {
  await db.deleteRegistration(req.params.id);
  res.json({ ok: true });
});

/* ---------------- START ---------------- */
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
