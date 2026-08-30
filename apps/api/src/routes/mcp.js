// MCP read-only ендпойнт — POST /api/mcp. Bearer MCP_SECRET (якщо env порожній — відкрито, тільки для dev).
const express = require('express');
const { TOOLS, READ_TOOL_NAMES, callTool } = require('@crm/mcp/src/tools');
const { handleJsonRpc } = require('@crm/mcp/src/jsonrpc');

const router = express.Router();
const readTools = TOOLS.filter((t) => READ_TOOL_NAMES.has(t.name));

function checkAuth(req) {
  if (!process.env.MCP_SECRET) return true; // dev-режим
  const header = req.header('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : String(req.query.token || '');
  return token === process.env.MCP_SECRET;
}

router.post('/mcp', express.json(), async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message: 'Unauthorized' } });
  const response = await handleJsonRpc({ tools: readTools, callTool }, req.body);
  res.json(response || { jsonrpc: '2.0', id: null, result: null });
});

router.get('/mcp', (req, res) => {
  res.json({ name: 'fineko-crm-mcp', mode: 'read', tools: readTools.map((t) => t.name) });
});

module.exports = router;
