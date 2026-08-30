// PM2 — той самий підхід, що система для воронок/platform/ecosystem.config.js (без Docker).
module.exports = {
  apps: [
    {
      name: 'crm-api',
      script: 'apps/api/src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env_production: { NODE_ENV: 'production' },
    },
    {
      // Примітка: це stdio-транспорт (readline stdin/stdout) — під PM2 без stdin він просто
      // простоює, реальний MCP-трафік іде через /api/mcp,/api/mcp-edit у crm-api. Тримаємо тут
      // для симетрії з platform-mcp (той самий патерн) — придатний для локального Claude Desktop.
      name: 'crm-mcp',
      script: 'apps/mcp/src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
