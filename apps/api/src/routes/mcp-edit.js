// MCP write-ендпойнт — POST /api/mcp-edit. Той самий auth що mcp.js.
const express = require('express');
const { TOOLS, WRITE_TOOL_NAMES, callTool } = require('@crm/mcp/src/tools');
const { handleJsonRpc } = require('@crm/mcp/src/jsonrpc');

const router = express.Router();
const writeTools = TOOLS.filter((t) => WRITE_TOOL_NAMES.has(t.name));

function checkAuth(req) {
  if (!process.env.MCP_SECRET) return true;
  const header = req.header('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : String(req.query.token || '');
  return token === process.env.MCP_SECRET;
}

router.post('/mcp-edit', express.json(), async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message: 'Unauthorized' } });
  const response = await handleJsonRpc({ tools: writeTools, callTool }, req.body);
  res.json(response || { jsonrpc: '2.0', id: null, result: null });
});

router.get('/mcp-edit', (req, res) => {
  res.json({ name: 'fineko-crm-mcp', mode: 'write', tools: writeTools.map((t) => t.name) });
});

module.exports = router;
