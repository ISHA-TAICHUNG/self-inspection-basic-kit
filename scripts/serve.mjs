import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSandboxRepository } from '../src/adapters/file-sandbox.mjs';
import { createLocalWeb } from '../src/adapters/local-web.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.KIT_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT_INVALID');
const config = JSON.parse(await readFile(resolve(root, 'config/example.json'), 'utf8'));
const repository = new FileSandboxRepository(resolve(root, '.local/sandbox'), config);
const web = createLocalWeb({ config, repository });
try { console.log('本機隔離示範：' + await web.listen(port)); }
catch (error) { repository.close(); throw error; }
let closing = false;
async function close() {
  if (closing) return; closing = true; await web.close(); repository.close(); process.exit(0);
}
process.on('SIGINT', close); process.on('SIGTERM', close);
