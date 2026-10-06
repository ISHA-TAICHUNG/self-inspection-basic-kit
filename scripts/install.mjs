import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installationPlan, applyInstallation } from '../src/adapters/installation.mjs';
import { requireValue } from '../src/domain/common.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const values = new Map();
const flags = new Set();
let failedStep = 'preview';
try {
  requireValue(Number(process.versions.node.split('.')[0]) >= 22, 'NODE_22_REQUIRED');
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (['--apply', '--prepare-environment'].includes(key)) {
      requireValue(!flags.has(key), 'INSTALL_ARGUMENT_INVALID'); flags.add(key);
    } else {
      requireValue(['--input', '--home', '--approve'].includes(key) && !values.has(key) &&
        args[index + 1] && !args[index + 1].startsWith('--'), 'INSTALL_ARGUMENT_INVALID');
      values.set(key, args[++index]);
    }
  }
  requireValue(flags.has('--apply') || !values.has('--approve'), 'INSTALL_ARGUMENT_INVALID');
  const config = JSON.parse(readFileSync(resolve(values.get('--input') ?? resolve(root, 'config/example.json')), 'utf8'));
  const plan = installationPlan(config);
  if (flags.has('--apply')) requireValue(values.get('--approve') === plan.configDigest, 'INSTALL_APPROVAL_REQUIRED');
  function runNpm(command) {
    failedStep = command.join(' ');
    const cli = process.env.npm_execpath;
    const result = spawnSync(cli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm',
      cli ? [cli, ...command] : command,
      { cwd: root, encoding: 'utf8', maxBuffer: 5000000, shell: !cli && process.platform === 'win32' });
    requireValue(result.status === 0, 'INSTALL_VERIFICATION_FAILED');
  }
  if (flags.has('--prepare-environment')) runNpm(['install', '--ignore-scripts', '--package-lock=false']);
  if (flags.has('--apply')) {
    // 核定與測試均成功才寫入；命令只使用固定參數，沒有雲端／通知步驟。
    runNpm(['test']); runNpm(['run', 'demo']); runNpm(['run', 'check:release']);
    failedStep = 'apply_and_readback';
    const data = applyInstallation(config, {
      directory: resolve(values.get('--home') ?? resolve(root, '.local')),
      approvedDigest: values.get('--approve') });
    console.log(JSON.stringify({ ...data, verification: 'local_tests_passed',
      cloudVerified: false, lineVerified: false }, null, 2));
  } else {
    console.log(JSON.stringify({ ...plan, applied: false, verification: 'preview_only',
      next: '核對配置後使用 --apply --approve 加上 configDigest；不代表正式啟用' }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code ?? 'INSTALL_FAILED',
    step: failedStep, applied: null, outcome: 'not_completed_verify_existing_files',
    lineSent: 0, production: false }));
  process.exitCode = 1;
}
