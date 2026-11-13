'use strict';
// 2026-11-13: старе сховище фото (чужий сервіс, акаунт закрито) віддає 500 — фото 22 товарів goverla більше не існують.
// Відновлення з того, що вже є в нашій CRM: товар → привʼязані оголошення (Ad.productId) → їхні пости Instagram (Ad.postId) →
// фото поста (для каруселі — усі кадри; для відео — обкладинка). Файли зберігаються у наш /uploads/<tenantId>/.
//   IG_TOKEN=<токен Instagram акаунта магазину> node scripts/restore-product-photos-2026-11-13.js --tenant=goverla_shop          (перевірка)
//   … --only=A0187,C0043 — лише ці артикули (для вибіркової перевірки)
//   IG_TOKEN=… node scripts/restore-product-photos-2026-11-13.js --tenant=goverla_shop --apply                                    (записати)
// Захист: копія старих списків фото у файл; товар оновлюється лише якщо за час роботи його НЕ змінили (менеджер міг залити нові фото);
// мертві посилання з Offer.images прибираються (бот тоді йде своїм «фото цього кольору нема», а не падає на завантаженні).
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
const tenantArg = (process.argv.find((a) => a.startsWith('--tenant=')) || '').slice(9);
const TOKEN = (process.env.IG_TOKEN || '').trim();
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? onlyArg.split(',').map((x) => x.trim().toUpperCase()) : null;
const MAX_PHOTOS = 5;
const MAX_POSTS = 12;
const isDead = (u) => /keycrm/i.test(String(u || ''));

async function graph(id) {
    const f = 'media_type,media_url,thumbnail_url,children{media_type,media_url}';
    const r = await fetch(`https://graph.instagram.com/v21.0/${encodeURIComponent(id)}?fields=${encodeURIComponent(f)}&access_token=${encodeURIComponent(TOKEN)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (j.error && j.error.message) || ('HTTP ' + r.status) };
    return j;
}
async function download(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//.test(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 8000 || buf.length > 8 * 1024 * 1024) return null;
    return { buf, ext: ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg' };
}

(async () => {
    if (!TOKEN) { console.log('потрібен IG_TOKEN (змінна середовища)'); process.exit(1); }
    const tenant = await db.tenant.findFirst({ where: { OR: [{ id: tenantArg }, { name: tenantArg }] } });
    if (!tenant) { console.log('магазин не знайдено:', tenantArg); process.exit(1); }
    const dir = path.join(__dirname, '..', 'uploads', tenant.id);
    if (APPLY) fs.mkdirSync(dir, { recursive: true });

    const products = await db.product.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, sku: true, name: true, images: true, thumbnailUrl: true, updatedAt: true, offers: { select: { id: true, images: true } } },
    });
    const broken = products.filter((p) => (!ONLY || ONLY.includes(String(p.sku).toUpperCase())) && (p.images.some(isDead) || p.offers.some((o) => (o.images || []).some(isDead))));
    console.log('магазин', tenant.name, '| товарів з мертвими фото:', broken.length);

    const backup = broken.map((p) => ({ id: p.id, sku: p.sku, images: p.images, thumbnailUrl: p.thumbnailUrl, offers: p.offers.map((o) => ({ id: o.id, images: o.images })) }));
    if (APPLY) { const bf = path.join(process.env.BACKUP_DIR || '/root', 'product_images_backup_2026-11-13' + (ONLY ? '_' + ONLY.join('-') : '') + '.json'); fs.writeFileSync(bf, JSON.stringify(backup), { mode: 0o600 }); console.log('копія старих фото:', bf); }

    const summary = [];
    for (const p of broken) {
        const liveOld = p.images.filter((u) => !isDead(u));
        const restored = [];
        let note = '';
        if (!liveOld.length) {
            const ads = await db.ad.findMany({ where: { tenantId: tenant.id, productId: p.id, postId: { not: null } }, select: { postId: true, mediaType: true } });
            const byPost = new Map();
            for (const a of ads) { const e = byPost.get(a.postId) || { n: 0, type: a.mediaType }; e.n++; byPost.set(a.postId, e); }
            // фото-пости й каруселі — першими, потім відео (обкладинка); всередині групи — де більше оголошень
            const posts = [...byPost.entries()].sort((a, b) => ((a[1].type === 'VIDEO') - (b[1].type === 'VIDEO')) || (b[1].n - a[1].n)).slice(0, MAX_POSTS);
            const urls = [];
            let err = '';
            for (const [postId] of posts) {
                if (urls.length >= MAX_PHOTOS) break;
                const m = await graph(postId);
                if (m.error) { err = m.error; continue; }
                if (m.media_type === 'CAROUSEL_ALBUM' && m.children && m.children.data) { for (const c of m.children.data) if (c.media_type === 'IMAGE' && c.media_url) urls.push(c.media_url); }
                else if (m.media_type === 'VIDEO') { if (m.thumbnail_url) urls.push(m.thumbnail_url); }
                else if (m.media_url) urls.push(m.media_url);
            }
            let n = 0;
            for (const u of [...new Set(urls)].slice(0, MAX_PHOTOS)) {
                const d = await download(u);
                if (!d) continue;
                n++;
                if (APPLY) {
                    const name = `restored-${String(p.sku || p.id).replace(/[^A-Za-z0-9_-]/g, '')}-${n}.${d.ext}`;
                    fs.writeFileSync(path.join(dir, name), d.buf);
                    restored.push(`/uploads/${tenant.id}/${name}`);
                } else restored.push('(було б збережено)');
            }
            note = restored.length ? `відновлено ${restored.length} з ${posts.length} постів` : (posts.length ? 'пости є, фото не дістали: ' + (err || 'порожньо') : 'до товару не привʼязано жодного поста');
        } else note = 'є робочі фото — лише прибрано мертві посилання';

        if (APPLY) {
            const fresh = await db.product.findUnique({ where: { id: p.id }, select: { updatedAt: true } });
            if (fresh && fresh.updatedAt.getTime() === p.updatedAt.getTime()) {
                const next = [...liveOld, ...restored];
                await db.product.update({ where: { id: p.id }, data: { images: next } });
            } else note += ' | НЕ оновлено: товар змінили під час роботи';
            for (const o of p.offers) if ((o.images || []).some(isDead)) await db.offer.update({ where: { id: o.id }, data: { images: o.images.filter((u) => !isDead(u)) } });
        }
        summary.push(`${p.sku}: ${note}`);
    }
    console.log(summary.join('\n'));
    console.log(APPLY ? 'ГОТОВО' : 'Це перевірка — нічого не записано (додайте --apply)');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
