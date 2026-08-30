# Fineko CRM

Окремий мікросервіс CRM для товарного бізнесу через соцмережі (Instagram тощо) —
заміна KeyCRM для воронок `goverla_shop`/`covercar_ua`, продається як частина
пакету разом з AI-воронкою продажів FINEKO. Повне ТЗ: [`ТЗ-власна-СРМ.md`](./ТЗ-власна-СРМ.md).

## Стек

Node.js 18+ / Express / PostgreSQL + Prisma / React + Vite + Tailwind / PM2.
Той самий стиль конвенцій, що й `система для воронок/platform` (yarn workspaces,
CommonJS, MCP у форматі JSON-RPC 2.0), окрема БД, окремий домен `crm.fineko.space`,
автентифікація через єдиний FINEKO SSO.

## Структура

```
apps/
  api/      ← Express API (порт 4700)
  mcp/      ← MCP tools (list_/get_/create_/update_ CRUD + JSON-RPC)
  admin/    ← React SPA (Vite, Tailwind, темна тема)
packages/
  db/       ← Prisma client + schema.prisma (модель даних §4 ТЗ)
  logger/   ← Winston logger (sanitize секретів)
  errors/   ← Ієрархія помилок + мапінг на HTTP-статуси
```

## Швидкий старт (локально)

```bash
yarn install
cp .env.example .env      # виправити DATABASE_URL/SSO_* за потреби
yarn db:generate
yarn db:migrate:dev        # створює БД fineko_crm (кластер D:\fineko_pg)
yarn db:seed                # tenant + дефолтна воронка для розробки
yarn dev:api                 # http://localhost:4700
yarn dev:admin                # http://localhost:5173 (проксі /api → 4700)
```

## Деплой

Дивись `ecosystem.config.js` (PM2) і `deploy.sh` — за тим самим підходом,
що й `система для воронок/platform` (без Docker, голий VPS + PM2).

```bash
git pull origin main
yarn install --frozen-lockfile
yarn db:migrate:deploy
yarn build:admin
pm2 restart crm-api crm-mcp
```
