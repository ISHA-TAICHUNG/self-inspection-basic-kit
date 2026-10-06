import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, lstatSync, symlinkSync,
  chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import example from '../config/example.json' with { type: 'json' };
import { installationPlan, applyInstallation, loadInstallation } from '../src/adapters/installation.mjs';
import { FileSandboxRepository } from '../src/adapters/file-sandbox.mjs';
import { createLocalWeb } from '../src/adapters/local-web.mjs';

const code = expected => error => error.code === expected;
const home = () => mkdtempSync(join(tmpdir(), 'isha-kit-install-'));
const apply = (directory, config = example) => applyInstallation(config,
  { directory, approvedDigest: installationPlan(config).configDigest });

test('安裝預覽不寫檔、不洩漏設定或人員；未核定及錯摘要均拒絕', () => {
  const directory = home();
  const plan = installationPlan(example);
  assert.equal(plan.dailyCount, 2); assert.equal(plan.monthlyCount, 2);
  assert.ok(!JSON.stringify(plan).includes('demo-inspector'));
  assert.ok(!JSON.stringify(plan).includes('FAKE-BINDING'));
  for (const approvedDigest of [undefined, 'bad']) {
    assert.throws(() => applyInstallation(example, { directory, approvedDigest }), code('INSTALL_APPROVAL_REQUIRED'));
  }
  assert.equal(existsSync(join(directory, 'active-installation.json')), false);
  assert.equal(existsSync(join(directory, 'installations')), false);
});

test('核定安裝保存設定與空資料庫，所有私有檔案讀回一致', () => {
  const directory = home();
  const result = apply(directory);
  assert.equal(result.applied, true); assert.equal(result.reused, false);
  const installed = loadInstallation(directory);
  assert.deepEqual(installed.config, example);
  for (const file of [join(directory, 'active-installation.json'),
    join(installed.dataDirectory, 'state.json'), join(installed.dataDirectory, '../config.json')]) {
    assert.equal(lstatSync(file).mode & 0o077, 0);
  }
  assert.equal(existsSync(join(directory, 'installer.lock')), false);
});

test('同設定重跑不清空既有資料、不新增安裝；不同設定拒絕原地替換', () => {
  const directory = home(); apply(directory);
  const installed = loadInstallation(directory);
  const repository = new FileSandboxRepository(installed.dataDirectory, installed.config);
  repository.withLock(() => repository.put('records', 'retained-record', { value: '既有示範資料' }));
  const before = readFileSync(join(installed.dataDirectory, 'state.json'));
  assert.equal(apply(directory).reused, true);
  const changed = structuredClone(example); changed.configVersion = 'DEMO-2';
  assert.throws(() => apply(directory, changed), code('INSTALL_CONFIG_MIGRATION_REQUIRED'));
  assert.deepEqual(readFileSync(join(installed.dataDirectory, 'state.json')), before);
  repository.close();
  const reopened = new FileSandboxRepository(installed.dataDirectory, example);
  assert.deepEqual(reopened.get('records', 'retained-record'), { value: '既有示範資料' }); reopened.close();
});

test('第二個安裝程序拒絕，不移除他人的 lock', () => {
  const directory = home();
  const lock = join(directory, 'installer.lock'); writeFileSync(lock, 'other', { mode: 0o600 });
  assert.throws(() => apply(directory), code('INSTALLER_BUSY'));
  assert.equal(readFileSync(lock, 'utf8'), 'other');
});

test('未完成啟用不降級成範例；沿同設定恢復保留已寫資料，資料 writer 未退出則拒絕', () => {
  const directory = home(); apply(directory);
  const installed = loadInstallation(directory);
  const repository = new FileSandboxRepository(installed.dataDirectory, installed.config);
  repository.withLock(() => repository.put('records', 'partial-record', { value: '不清空' }));
  // 只在測試剛建立的暫存目錄模擬未發佈指標，不改使用者資料。
  unlinkSync(join(directory, 'active-installation.json'));
  assert.throws(() => loadInstallation(directory), code('INSTALL_ACTIVATION_REQUIRED'));
  assert.throws(() => apply(directory), code('WRITER_ALREADY_RUNNING'));
  repository.close();
  assert.equal(apply(directory).readback, true);
  const resumed = new FileSandboxRepository(installed.dataDirectory, example);
  assert.deepEqual(resumed.get('records', 'partial-record'), { value: '不清空' }); resumed.close();
});

test('損壞指標、設定、收據、資料或私有權限均拒絕，不退回範例', () => {
  for (const target of ['manifest', 'config', 'receipt', 'state', 'permissions']) {
    const directory = home(); apply(directory);
    const installed = loadInstallation(directory);
    const pointer = join(directory, 'active-installation.json');
    const files = { manifest: pointer, config: join(installed.dataDirectory, '../config.json'),
      receipt: join(installed.dataDirectory, '../receipt.json'), state: join(installed.dataDirectory, 'state.json') };
    if (target === 'permissions') {
      chmodSync(pointer, 0o644);
      assert.throws(() => loadInstallation(directory), code('INSTALL_FILE_NOT_PRIVATE'));
    } else {
      writeFileSync(files[target], '{}');
      assert.throws(() => loadInstallation(directory));
      assert.throws(() => apply(directory));
    }
  }
});

test('symlink 安裝根及設定檔不能用來改寫或讀取其他目錄', () => {
  const directory = home(); const linked = join(home(), 'linked');
  symlinkSync(directory, linked, 'dir');
  assert.throws(() => apply(linked), code('INSTALL_PATH_INVALID'));
  assert.equal(existsSync(join(directory, 'active-installation.json')), false);
  const fake = join(directory, 'active-installation.json');
  const other = join(home(), 'private.json'); writeFileSync(other, '{}', { mode: 0o600 });
  symlinkSync(other, fake);
  assert.throws(() => loadInstallation(directory), code('INSTALL_FILE_NOT_PRIVATE'));
});

test('未實作照片、沒有檢查人與 production 設定在安裝前拒絕', () => {
  const photo = structuredClone(example); photo.templates[0].items[0].photoPolicy = 'always';
  assert.throws(() => installationPlan(photo), code('PHOTO_NOT_IMPLEMENTED'));
  const nobody = structuredClone(example); nobody.people[0].active = false;
  assert.throws(() => installationPlan(nobody), code('INSPECTOR_REQUIRED'));
  assert.throws(() => installationPlan({ ...example, mode: 'production' }), code('PRODUCTION_NOT_IMPLEMENTED'));
});

test('安裝後 Web 讀取核定的設備及項目；重啟仍讀取同設定', async () => {
  const directory = home(); const config = structuredClone(example);
  config.organization = '配置測試單位'; config.configVersion = 'CUSTOM-DEMO-1';
  config.equipment[0].name = '自訂示範設備'; config.templates[0].items[0].label = '自訂示範檢查項目';
  apply(directory, config);
  for (let index = 0; index < 2; index++) {
    const installed = loadInstallation(directory);
    const repository = new FileSandboxRepository(installed.dataDirectory, installed.config);
    const app = createLocalWeb({ config: installed.config, repository });
    const origin = await app.listen(0);
    try {
      const response = await fetch(origin + '/api/session');
      const session = await response.json();
      const result = await fetch(origin + '/api/rpc', { method: 'POST',
        headers: { Cookie: response.headers.get('set-cookie').split(';')[0], Origin: origin,
          'X-Kit-CSRF': session.csrf, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }) });
      const { data } = await result.json();
      assert.equal(data.organization, '配置測試單位');
      assert.equal(data.equipment[0].name, '自訂示範設備');
      assert.equal(data.templates[0].items[0].label, '自訂示範檢查項目');
      assert.equal(data.capabilities.line, false); assert.equal(data.capabilities.production, false);
    } finally { await app.close(); repository.close(); }
  }
});

test('安裝 CLI 預覽與錯誤參數不套用、不啟動其他服務', () => {
  const directory = home(); const script = new URL('../scripts/install.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [fileURLToPath(script), '--home', directory, ...args], { encoding: 'utf8' });
  const preview = run([]);
  assert.equal(preview.status, 0); assert.equal(JSON.parse(preview.stdout).applied, false);
  for (const args of [['--apply'], ['--apply', '--approve', 'bad'], ['--unknown'], ['--input']]) {
    const denied = run(args); assert.equal(denied.status, 1);
    assert.equal(JSON.parse(denied.stderr).ok, false);
  }
  assert.equal(existsSync(join(directory, 'active-installation.json')), false);
});
