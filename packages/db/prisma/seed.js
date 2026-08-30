// Bootstrap-сід для локальної розробки: один tenant + дефолтна воронка стадій.
// Запуск: yarn db:seed
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo Shop (dev seed)',
    },
  });

  const pipeline = await prisma.pipeline.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      tenantId: tenant.id,
      name: 'Основна воронка',
      stages: {
        create: [
          { name: 'Новий', order: 0 },
          { name: 'В обробці', order: 1 },
          { name: 'Відправлено', order: 2 },
          { name: 'Завершено', order: 3 },
          { name: 'Скасовано', order: 4 },
        ],
      },
    },
  });

  console.log('Seed OK:');
  console.log('  tenant.id      =', tenant.id);
  console.log('  tenant.apiKey  =', tenant.apiKey);
  console.log('  pipeline.id    =', pipeline.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
