/**
 * Generate a quote card through OUR ChatGPT (the chatgpt-webui-mcp server,
 * which drives chatgpt.com through camofox) — the same pipeline that made
 * cards 59–64.
 *
 *   node scripts/generate-cards.mjs "<prompt>"
 *
 * The MCP server saves the raw image under
 * C:\Users\Admin\.chatgpt-webui-mcp\images\chatgpt-image-*.png
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';

const MCP_PKG = 'C:/Users/Admin/AppData/Roaming/npm/node_modules/chatgpt-webui-mcp';
const token = readFileSync('C:/Users/Admin/.secrets/chatgpt-session', 'utf8').trim();

const prompt = process.argv[2];
if (!prompt) {
  console.error('usage: node scripts/generate-cards.mjs "<prompt>"');
  process.exit(2);
}
const waitMs = Number(process.argv[3] ?? 600000);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${MCP_PKG}/dist/index.js`],
  env: {
    ...process.env,
    CHATGPT_SESSION_TOKEN: token,
    CHATGPT_TRANSPORT: 'camofox',
    CHATGPT_BROWSER_BASE_URL: 'http://127.0.0.1:9377',
    CHATGPT_USER_ID: 'chatgpt-webui-mcp',
    CHATGPT_SESSION_KEY: 'chatgpt-webui',
    CHATGPT_WORKSPACE: 'PRO',
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'card-generator', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const res = await client.callTool(
  {
    name: 'chatgpt_webui_prompt',
    arguments: {
      prompt,
      create_image: true,
      model_mode: 'auto',
      workspace: 'PRO',
      wait_timeout_ms: waitMs,
    },
  }
);

const text = (res.content ?? [])
  .filter((c) => c.type === 'text')
  .map((c) => c.text)
  .join('\n');
console.log('--- result ---');
console.log(text.slice(0, 4000));
for (const c of res.content ?? []) {
  if (c.type !== 'text' && c.mimeType?.startsWith('image/')) {
    console.log(`(image content: ${c.mimeType}, ${c.data?.length ?? 0} b64 chars)`);
  }
}

await client.close();
