import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import example from '../config/example.json' with { type: 'json' };
import { chunks, ChunkedRepository } from '../src/adapters/chunked.mjs';
import { FileSandboxRepository } from '../src/adapters/file-sandbox.mjs';
import { googleIdentity } from '../src/adapters/google-identity.mjs';
import { inspectionProgress, webState } from '../src/application/view.mjs';
import { createLocalWeb } from '../src/adapters/local-web.mjs';
import { fixture, inspection, context } from './helpers.mjs';
import { MemoryRepository } from '../src/adapters/memory.mjs';
import { KitService } from '../src/application/service.mjs';

function storeFixture() {
  const rows = []; let held = false;
  const bridge = { readRows: () => structuredClone(rows), appendRows: added => rows.push(...structuredClone(added)),
    withLock: fn => { assert.equal(held, false); held = true; try { return fn(); } finally { held = false; } } };
  return { rows, bridge, repository: new ChunkedRepository(bridge) };
}
const code = expected => error => error.code === expected;

test('分段保存超過單格大小的 Unicode，讀回與摘要一致', () => {
  const { repository, rows } = storeFixture();
  const value = { note: '示範😀'.repeat(20000) };
  repository.withLock(() => repository.put('records', 'record-large', value));
  assert.deepEqual(repository.get('records', 'record-large'), value);
  assert.ok(rows.length > 3);
  assert.ok(rows.every(row => row[6].length <= 18002));
  const segments = chunks('a'.repeat(17999) + '😀');
  assert.equal(segments[0].length, 17999);
  assert.equal(segments.join(''), 'a'.repeat(17999) + '😀');
});

test('Sheets 內容分段有文字前綴，不讓使用者內容被解析成公式', () => {
  const { repository, rows } = storeFixture();
  repository.withLock(() => repository.put('records', 'record-formula',
    { note: 'a'.repeat(17990) + '=IMPORTXML("invalid", "invalid")' }));
  assert.ok(rows.every(row => !String(row[6]).startsWith('=')));
  assert.ok(rows.filter(row => row[3] >= 0).every(row => row[6].startsWith('J:')));
});

test('封存前中斷不宣稱保存；同內容重送不增加重複分段', () => {
  const { repository, rows, bridge } = storeFixture();
  const original = bridge.appendRows; let interrupt = true;
  repository.appendRows = added => {
    if (added[0][3] === -1 && interrupt) { interrupt = false; throw new Error('模擬封存前中斷'); }
    original(added);
  };
  assert.throws(() => repository.withLock(() => repository.put('records', 'record-1', { note: '測試' })));
  assert.equal(repository.get('records', 'record-1'), undefined);
  repository.withLock(() => repository.put('records', 'record-1', { note: '測試' }));
  assert.equal(rows.length, 2);
  assert.deepEqual(repository.get('records', 'record-1'), { note: '測試' });
});

test('有封存的資料缺段或遭改寫必須拒絕，不悄悄回退', () => {
  const { repository, rows } = storeFixture();
  repository.withLock(() => repository.put('records', 'record-1', { value: '原始資料' }));
  rows[0][6] = 'J:更改內容';
  assert.throws(() => repository.get('records', 'record-1'), code('STORE_CORRUPT'));
});

test('原始列不可覆寫，所有寫入必須持鎖', () => {
  const { repository } = storeFixture();
  assert.throws(() => repository.put('records', 'record-1', {}), code('STORE_LOCK_REQUIRED'));
  repository.withLock(() => repository.put('records', 'record-1', { value: 1 }));
  assert.throws(() => repository.withLock(() => repository.put('records', 'record-1', { value: 2 })), code('ROW_CONTENT_CONFLICT'));
});

test('核心用分段儲存完成異常與同 ID 重送，只留一筆紀錄', () => {
  const { repository } = storeFixture(); const { service: oldService } = fixture();
  const service = new KitService({ config: oldService.config, repository, identity: oldService.identity, clock: oldService.clock });
  const result = service.execute(context(), inspection());
  assert.equal(result.status, 'complete');
  assert.deepEqual(service.execute(context(), inspection()), result);
  assert.equal(repository.list('records').length, 1);
  assert.equal(repository.list('cases').length, 1);
});

test('本機重啟讀回，未知 schema 或摘要破壞均拒絕', () => {
  const directory = mkdtempSync(join(tmpdir(), 'isha-kit-test-'));
  const repository = new FileSandboxRepository(directory, example);
  repository.withLock(() => repository.put('records', 'record-1', { value: '測試' })); repository.close();
  const restarted = new FileSandboxRepository(directory, example);
  assert.deepEqual(restarted.get('records', 'record-1'), { value: '測試' }); restarted.close();
  const file = join(directory, 'state.json'); const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.schemaVersion = 999; writeFileSync(file, JSON.stringify(saved));
  assert.throws(() => new FileSandboxRepository(directory, example), code('STORE_SCHEMA_OR_CONFIG_CHANGED'));
  saved.schemaVersion = 1; saved.checksum = 'bad'; writeFileSync(file, JSON.stringify(saved));
  assert.throws(() => new FileSandboxRepository(directory, example), code('STORE_CORRUPT'));
});

test('本機第二個 writer 拒絕，關閉不刪除資料', () => {
  const directory = mkdtempSync(join(tmpdir(), 'isha-kit-writer-'));
  const first = new FileSandboxRepository(directory, example);
  assert.throws(() => new FileSandboxRepository(directory, example), code('WRITER_ALREADY_RUNNING'));
  first.close();
});

test('Google 空白、未知、前端冒充身分拒絕；只取伺服器核定名單', () => {
  const bindings = { 'demo@example.invalid': 'demo-inspector' };
  assert.throws(() => googleIdentity('', bindings).authenticate({ email: 'demo@example.invalid' }), code('GOOGLE_IDENTITY_UNAVAILABLE'));
  assert.throws(() => googleIdentity('other@example.invalid', bindings).authenticate(), code('NOT_ALLOWLISTED'));
  assert.deepEqual(googleIdentity('DEMO@example.invalid', bindings).authenticate({ personId: 'demo-admin' }),
    { subject: 'demo-inspector' });
});

test('日／月分母分開且重複紀錄不灌進度；停工日無日檢分母', () => {
  const actor = example.people[0];
  const record = { id: 'record-1', inspection: { requirement: example.requirements[0], period: '2026-10-06' } };
  const progress = inspectionProgress(example, { records: [record, record] }, actor, '2026-10-06T08:00:00Z');
  assert.equal(progress.filter(row => row.cycle === 'daily' && row.completed).length, 1);
  assert.equal(progress.filter(row => row.cycle === 'monthly' && row.completed).length, 0);
  const stopped = structuredClone(example); stopped.calendar.closedDates.push('2026-10-06');
  assert.ok(inspectionProgress(stopped, { records: [] }, actor, '2026-10-06T08:00:00Z')
    .filter(row => row.cycle === 'daily').every(row => !row.required));
});

test('畫面範本只含本人場域需求，不回傳其他場域範本', () => {
  const config = structuredClone(example);
  config.sites.push({ id: 'SITE-B', name: '第二示範場域' });
  config.templates.push({ ...config.templates[0], id: 'OTHER-TEMPLATE',
    items: [{ id: 'OTHER-ITEM', label: '不可跨域讀取', method: '示範', photoPolicy: 'none' }] });
  config.equipment.push({ id: 'OTHER-EQUIPMENT', name: '第二場域設備', siteId: 'SITE-B', active: true });
  config.requirements.push({ ...config.requirements[0], id: 'OTHER-REQUIREMENT',
    equipmentId: 'OTHER-EQUIPMENT', templateId: 'OTHER-TEMPLATE' });
  config.people.filter(row => row.roles.includes('handle') || row.roles.includes('confirm'))
    .forEach(row => row.sites.push('SITE-B'));
  const { service } = fixture(config);
  const state = webState(service, context(), { storage: 'memory' });
  assert.ok(!state.templates.some(row => row.id === 'OTHER-TEMPLATE'));
  assert.ok(!state.equipment.some(row => row.id === 'OTHER-EQUIPMENT'));
  assert.ok(!state.requirements.some(row => row.id === 'OTHER-REQUIREMENT'));
});

test('HTTP 只允許 loopback／同源與 CSRF；假身分不能從 command 指定', async () => {
  const app = createLocalWeb({ config: example, repository: new MemoryRepository() });
  const origin = await app.listen(0);
  try {
    const sessionResponse = await fetch(origin + '/api/session');
    const { csrf } = await sessionResponse.json();
    const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
    const call = async (payload, extra = {}) => {
      const response = await fetch(origin + '/api/rpc', { method: 'POST',
        headers: { Cookie: cookie, Origin: origin, 'X-Kit-CSRF': csrf, 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(payload) });
      return { status: response.status, ...(await response.json()) };
    };
    assert.equal((await call({ action: 'bootstrap' })).data.viewer.id, 'demo-inspector');
    assert.equal((await call({ action: 'bootstrap' }, { Origin: 'https://example.invalid' })).error.code, 'CSRF_DENIED');
    const badHost = await new Promise((resolve, reject) => {
      const request = http.request(origin + '/api/session', { headers: { Host: 'example.invalid' } }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(JSON.parse(body)));
      }); request.on('error', reject); request.end();
    });
    assert.equal(badHost.error.code, 'LOOPBACK_ONLY');
    assert.equal((await call({ action: 'bootstrap', actorId: 'demo-admin' })).error.code, 'REQUEST_INVALID');
    assert.equal((await call({ action: 'execute', command: { ...inspection(), actorId: 'demo-admin' } })).error.code,
      'UNEXPECTED_COMMAND_FIELD');
    assert.equal((await call({ action: 'preview', id: 'unknown' })).error.code, 'CASE_NOT_FOUND');
  } finally { await app.close(); }
});
