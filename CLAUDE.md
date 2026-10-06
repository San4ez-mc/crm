# Fineko CRM — правила роботи над проєктом

> Читається автоматично на початку кожної сесії. Повне ТЗ — [`ТЗ-власна-СРМ.md`](./ТЗ-власна-СРМ.md).

---

## 1. Що це і чого НЕ робити

Окремий мікросервіс з нуля (своя БД, свій API/MCP) — НЕ таблиці всередині
`система для воронок/platform`. Мультитенантний з першого дня. Свідомо не
включено (див. ТЗ §8): облік залишків, ліди/дзвінки, вбудований чат, лог
доставки інтеграцій в UI, загальне BI, маркетплейси, розсилки, білінг.

## 2. Правило: всі зміни — через Git

Той самий процес, що й у `platform`: локально → commit → push → на сервері
`git pull` → `pm2 restart crm-api crm-mcp`. Ніколи не редагувати файли прямо
на сервері.

## 3. Правило: ключі — тільки per-tenant

`Tenant.apiKey` — єдиний секрет per-магазин (Bearer для воронки/MCP/Flows-
автоматизацій). Ніяких `.env`-ключів на конкретний магазин. Системні ключі
(SSO_CLIENT_SECRET, MCP_SECRET, DATABASE_URL) — у `.env`, вони одні на весь
сервіс, не per-tenant.

## 4. Правило: нова сутність → 4 місця одночасно

При додаванні нового поля/сутності моделі даних оновити всі чотири:
1. `packages/db/prisma/schema.prisma` (+ `yarn db:migrate:dev`).
2. `apps/api/src/routes/*.js` — CRUD-роут.
3. `apps/mcp/src/tools.js` — відповідний `list_/get_/create_/update_` тул у `TOOLS[]` + `callTool`.
4. `apps/admin/src/pages/*.jsx` — форма/список у UI (сторінка з §9 ТЗ).

## 5. Автентифікація

- **Веб-адмінка** — SSO-сесія (redirect-флоу, див. `apps/api/src/routes/auth-sso.js`). Права: `role` (`superadmin`|`user`|`none`) + `projectIds` = список `Tenant.id`, до яких є доступ; superadmin бачить усі tenants.
- **Воронка / Flows-автоматизації / MCP** — `Authorization: Bearer <Tenant.apiKey>`.
- CRM підтримує контракт SSO-панелі: `GET /api/auth/sso/projects` (tenants), `GET /api/auth/sso/pages` (меню §3), обидва захищені `x-sso-secret`.

## 6. MCP-стиль

Той самий, що в `platform`: один файл `TOOLS[]` + `callTool()`, JSON-RPC 2.0,
два ендпойнти `/api/mcp` (read) / `/api/mcp-edit` (write) з `Set` дозволених
імен, Bearer-auth.

## 7. Формат відповіді API

Завжди `{ ok: true, data }` або `{ ok: false, error: { code, message, context? } }`.
Помилки — через класи з `@crm/errors` (`AuthError`→401, `NotFoundError`→404,
`ValidationError`→400, `ConflictError`→409, решта `CrmError`→500) і єдиний
`errorHandler` middleware в кінці express-стеку.

## 8. Деплой — чеклист

```bash
git add <files> && git commit -m "..." && git push origin main
ssh root@173.242.62.180
cd /var/www/crm.fineko.space
git pull origin main
yarn install --frozen-lockfile
yarn workspace @crm/db run migrate:deploy
yarn workspace @crm/db run generate   # ОБОВʼЯЗКОВО окремо — див. §9.4
yarn build:admin
pm2 restart crm-api crm-mcp
pm2 logs crm-api --lines 20
```

Сервер: `173.242.62.180`, prod-домен `pcrm.fineko.space`.

## 9. Уроки з помилок

### 9.1 Період-фільтр `to=YYYY-MM-DD` — це північ, а не кінець доби

**Помилка:** `new Date("2026-08-30")` парситься як `2026-08-30T00:00:00.000Z`. У фільтрах `createdAt: { lte: to }` (аналітика §6, список замовлень, ad-spend, product-expenses) це виключало записи, створені сьогодні пізніше півночі — знайдено через smoke-test: тестове замовлення не потрапляло в «Топ товарів».
**Правило:** Дата-only `to` завжди проганяти через `parseTo()` з `apps/api/src/lib/dateRange.js` — вона виставляє `23:59:59.999` для дата-only рядків. Не парсити `to` напряму через `new Date(String(to))` в жодному новому ендпойнті з періодом.

### 9.3 PowerShell `Get-Content`/`Set-Content` мовчки б'є кирилицю в .jsx/.js файлах

**Помилка:** Спробував масову заміну `money(` → `usd(` через `(Get-Content ... -Raw) -replace ... | Set-Content -Encoding utf8` — файл прочитався в системному codepage (не UTF-8) до replace, тому всі кириличні рядки перетворились на мокроджибіш (`Р СѓРєР°...`), а `-Encoding utf8` на виході цього вже не рятує.
**Правило:** Для правок файлів з кирилицею — тільки Edit/Write інструменти, ніколи PowerShell `Get-Content`/`Set-Content`/`-replace` навіть з `-Encoding utf8` на запис (проблема в читанні, не в записі). Той самий клас багу, що §9.2, інший інструмент.

### 9.4 `prisma migrate deploy` НЕ регенерує Prisma Client — на відміну від `migrate dev`

**Помилка:** Після додавання Fop/TenantSecret/bulkPricing/isSet — задеплоїв (`git pull` → `migrate:deploy` → `build:admin` → `pm2 restart`), але перший же реальний запит (повторний прогін `migrate-keycrm.js --apply` на проді) впав з `PrismaClientValidationError: Unknown argument 'bulkPricing'`. Причина: `migrate:deploy` (на відміну від `migrate:dev`, який сам друкує "Running generate...") лишає СТАРИЙ згенерований `@prisma/client` на диску — `pm2 restart` підхопив старий клієнт, що не знав про нові поля/моделі. `yarn install --frozen-lockfile` теж не тригерить generate, якщо lockfile не змінився ("Already up-to-date" за 0.26с).
**Правило:** Після КОЖНОГО `migrate:deploy`, де змінювалась схема (нові поля/моделі), явно запускати `yarn workspace @crm/db run generate` ПЕРЕД `pm2 restart` — не покладатись, що deploy/install зробить це сам. Внесено в чеклист §8.

### 9.5 Запит у циклі по рядках (`Promise.all(ads.map(async …db…))`) — кладе весь CRM (2026-10-05)

**Помилка:** `/analytics/ads-conversion` робив 6 запитів на КОЖНЕ оголошення одночасно (у goverla 1730 оголошень ≈ 10 000 запитів), так само `/analytics/margin`, `/product-expenses` і `/ads/spend-summary` — по запиту на товар/оголошення. Пул Prisma — 9 зʼєднань: «Timed out fetching a new connection from the connection pool», сторінка «Аналітика» не вантажилась, а разом із нею падали запити всіх інших сторінок.
**Правило:** звіти по багатьох сутностях — агрегованими запитами (`groupBy` по `adId`/`currency`, один `findMany` з `firstTouchAdId: {not:null}`), зведення в памʼяті через `Map`. Витрати по товарах — `adSpendUAHByProduct()` з `lib/currency.js`; по оголошеннях — `computeAdStatsBatch()` у `routes/ads.js`. `sumAdSpendUAH` — лише для ОДНОГО фільтра, ніколи в циклі.

### 9.6 Картка розмови ≠ замовлення; реклама — за Meta-id через одне місце (2026-10-06)

**Помилки:** (1) з 09.09 кожна розмова воронки — рядок `Order` (картка, товар із ціною після презентації), а «продаж» у звітах визначався лише як «не відмова й не повернення» → «Аналітика» за 7 днів показувала 4,71 млн грн виручки замість 307 тис. (3313 «замовлень» замість 179). (2) Атрибуція: з 13.09 агент Flows не передавав рекламу (графовий рушій ставив `firstEntryAdId`), картка (`/funnel-events`) рекламу не приймала, «кліки/контакти» читали `AdClick`, яку ніхто не заповнює — у звіті реклами всюди нулі.
**Правило:** «що таке замовлення/продаж/лід» — лише фрагменти з `lib/margin.js` (`ORDER_PLACED_WHERE` = є покупець, `REAL_SALE_ORDER_WHERE`, `LEAD_WHERE` = картка воронки); жоден звіт не рахує `db.order` без них. Реклама замовлення — лише через `lib/adAttribution.js` (`touchFields`: Meta-id → Ad, firstTouch не перезаписується, lastTouch лише новіший); «контакти з реклами» = картки з `firstTouchAdId`. Групування просувань — `Ad.postId` = `effective_instagram_media_id` (`effective_object_story_id` у кожного boost свій — перевірено живим викликом).

### 9.2 Git Bash + інлайн кирилиця в `curl -d '...'` — мовчки б'є байти

**Помилка:** Тестові запити `curl -d '{"name":"Худі оверсайз"}'` через Git Bash на Windows зіпсували кирилицю в БД (`????`-байти), хоча JSON лишався валідним і запит повертав 200 — сам застосунок ні до чого, псується ще на рівні шелу до відправки.
**Правило:** Кирилицю в тестові curl-запити — тільки через файл (`--data-binary @payload.json`, файл записаний через Write/heredoc), ніколи інлайн у `-d '...'`. Той самий урок вже є в `система для воронок/platform/CLAUDE.md` §15.6 (там — про SSH+heredoc), тут — про сам curl.

---

*Створено: 2026-08-30, разом зі скафолдом монорепо.*
