import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateConfig } from '../src/domain/config.mjs';
import { installationPlan } from '../src/adapters/installation.mjs';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const source = inputIndex >= 0 ? args[inputIndex + 1] : 'config/example.json';
if (!source) throw new Error('需提供 --input 後的 JSON 路徑');
const config = validateConfig(JSON.parse(await readFile(resolve(source), 'utf8')));
const plan = installationPlan(config);
// 私有草稿不輸出人員姓名、綁定或任何憑證，也不覆寫既有草稿。
const directory = resolve('.local');
await mkdir(directory, { recursive: true });
const file = resolve(directory, 'config.draft.json');
await writeFile(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...plan, draft: file, mode: 'sandbox',
  applied: false, next: '核對摘要後以 install:sandbox 套用；不可作正式紀錄' }, null, 2));
