#!/usr/bin/env bash
# Деплой Fineko CRM на голий VPS — той самий підхід, що система для воронок/platform/deploy.sh
# (без Docker: Node + yarn + pm2 + Postgres напряму на сервері).
# Перший запуск на новому сервері встановлює залежності ОС; повторні — лише git pull + restart.
set -euo pipefail

APP_DIR="/var/www/crm.fineko.space"

echo "== Fineko CRM deploy =="

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Перший деплой: встанови Node 20, yarn, pm2, Postgres, nginx вручну (як для platform),"
  echo "потім: git clone <repo> $APP_DIR && cd $APP_DIR && cp .env.example .env (і заповнити)."
  exit 1
fi

cd "$APP_DIR"
git pull origin main
yarn install --frozen-lockfile
yarn db:migrate:deploy
yarn build:admin
pm2 startOrReload ecosystem.config.js --env production
pm2 save

echo "== Готово. Перевір: pm2 logs crm-api --lines 20 =="
