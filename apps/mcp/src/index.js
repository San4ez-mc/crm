// stdio-транспорт MCP (для локального підключення через Claude Desktop config) —
// той самий JSON-RPC 2.0, що й HTTP-ендпойнти в apps/api. Читає JSON-RPC рядки зі stdin.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const readline = require('node:readline');
const { TOOLS, callTool } = require('./tools');
const { handleJsonRpc } = require('./jsonrpc');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let body;
  try {
    body = JSON.parse(trimmed);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
    return;
  }
  const response = await handleJsonRpc({ tools: TOOLS, callTool }, body);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
});
