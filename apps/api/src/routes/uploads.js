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
// Mac/iPhone за замовчуванням експортують фото в HEIC/HEIF (Finder/Photos дуже часто цим
// грішить, поки власник вручну не перемкне "Preferences → Most Compatible") — браузери
// (крім Safari) взагалі не вміють показати HEIC у <img>, тож приймаємо файл і конвертуємо
// в JPEG на льоту (2026-09-07, знайдено по скарзі "фото не завантажуються на макбуці").
const HEIC_MIME = new Set(['image/heic', 'image/heif']);
const HEIC_EXT = /\.hei[cf]$/i;

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
    // Багато Mac-браузерів шлють HEIC як generic "application/octet-stream" — тому
    // додатково дивимось на розширення файлу, не лише на mimetype.
    cb(null, ALLOWED_MIME.has(file.mimetype) || HEIC_MIME.has(file.mimetype) || HEIC_EXT.test(file.originalname || ''));
  },
});

const router = express.Router();

router.post('/uploads', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('Файл обовʼязковий (поле "file"), дозволені типи: jpeg/png/webp/gif/heic, до 5MB');

  const isHeic = HEIC_MIME.has(req.file.mimetype) || HEIC_EXT.test(req.file.originalname || '');
  if (isHeic) {
    try {
      // Ледачий require — якщо колись пакет не встановиться на сервері, звичайні jpeg/png/webp
      // все одно продовжують працювати, падає лише сам HEIC-шлях.
      const convert = require('heic-convert');
      const inputBuffer = await fs.promises.readFile(req.file.path);
      const outputBuffer = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
      const jpegPath = req.file.path.replace(HEIC_EXT, '') + '.jpg';
      await fs.promises.writeFile(jpegPath, outputBuffer);
      await fs.promises.unlink(req.file.path).catch(() => {});
      req.file.filename = path.basename(jpegPath);
    } catch (e) {
      throw new ValidationError('Не вдалось конвертувати HEIC-фото в JPEG — спробуйте зберегти фото як JPEG (на iPhone: Налаштування → Камера → Формати → "Найбільш сумісний") і завантажити ще раз.');
    }
  }

  const url = `/uploads/${req.tenant.id}/${req.file.filename}`;
  res.status(201).json({ ok: true, data: { url } });
}));

module.exports = router;
