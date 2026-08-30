// Prisma singleton — той самий патерн, що й у платформі (система для воронок/platform/packages/db):
// захист від дублювання клієнтів при hot-reload у dev.
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = global;
const db = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

module.exports = { db };
