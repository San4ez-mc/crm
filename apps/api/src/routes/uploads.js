// Файлове сховище — §2 ТЗ: "Локально на VPS, окремий S3-сумісний сервіс не потрібен".
// Використовується для §9.3 (розмірна сітка, фото варіантів). Файли лежать у /uploads/<tenantId>/,
// роздаються статично (app.use('/uploads', ...) в index.js), самі файли — у .gitignore.
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { ValidationError } = require('@crm/errors');
const asyncHandler = require('../middleware/asyncHandler');

const UPLOADS_ROOT = path.join(__dirname, '../../../../uploads');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOADS_ROOT, req.tenant.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).slice(0, 10) || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

const router = express.Router();

router.post('/uploads', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Файл обовʼязковий (поле "file"), дозволені типи: jpeg/png/webp/gif, до 5MB');
  const url = `/uploads/${req.tenant.id}/${req.file.filename}`;
  res.status(201).json({ ok: true, data: { url } });
}));

module.exports = router;
