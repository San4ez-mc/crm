// JSON-RPC 2.0 handler, спільний для HTTP-транспорту (apps/api/routes/mcp*.js) і stdio (src/index.js).
// Формат — той самий, що platform: помилки як JSON-RPC error-об'єкт, а не HTTP-статус.
const { safeJsonStringify } = require('./tools');

async function handleJsonRpc({ tools, callTool }, body) {
  const { id, method, params } = body || {};
  try {
    if (method === 'initialize') {
      return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fineko-crm-mcp', version: '0.1.0' } } };
    }
    if (method === 'notifications/initialized') {
      return null; // нотифікація, без відповіді
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools } };
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (!tools.some((t) => t.name === name)) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown or unauthorized tool: ${name}` } };
      }
      const result = await callTool(name, args || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: safeJsonStringify(result) }] } };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
  }
}

module.exports = { handleJsonRpc };
