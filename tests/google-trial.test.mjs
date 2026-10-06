import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../.local/build/apps-script/KitCore.gs', import.meta.url), 'utf8');
function environment() {
  const owner = 'owner@example.invalid'; const props = new Map(); const sheets = new Map();
  const resources = new Map(); let current = owner; let held = false; let nextId = 1;
  const resource = id => ({ getId: () => id, getSharingAccess: () => 'PRIVATE',
    getOwner: () => ({ getEmail: () => owner }) });
  const makeSheet = () => {
    const rows = [];
    return { getLastRow: () => rows.length, getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: values => values.forEach((row, i) => { rows[r - 1 + i] ??= [];
        row.forEach((value, j) => { rows[r - 1 + i][c - 1 + j] = value; }); })
    }) };
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-06T08:00:00Z'])); } }
  const context = vm.createContext({ Date: FixedDate, console,
    Session: { getActiveUser: () => ({ getEmail: () => current }), getEffectiveUser: () => ({ getEmail: () => owner }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key) ?? null,
      setProperty: (key, value) => props.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (held) return false; held = true; return true; },
      releaseLock: () => { held = false; } }) },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFileById: id => resources.get(id),
      getFolderById: id => resources.get(id), createFolder: () => {
        const id = 'folder-' + nextId++; const value = resource(id); resources.set(id, value); return value;
      } },
    SpreadsheetApp: { create: () => {
      const id = 'sheet-' + nextId++; const tabs = new Map(); const value = { getId: () => id,
        setSpreadsheetTimeZone: () => {}, getSheetByName: name => tabs.get(name),
        insertSheet: name => { const sheet = makeSheet(); tabs.set(name, sheet); return sheet; } };
      sheets.set(id, value); resources.set(id, resource(id)); return value;
    }, openById: id => sheets.get(id), flush: () => {} },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algorithm, value) => Array.from(createHash('sha256').update(
        typeof value === 'string' ? value : Buffer.from(value)).digest()) }
  });
  vm.runInContext(source, context);
  const call = (method, value) => JSON.parse(JSON.stringify(context.KitCore[method](value)));
  return { call, props, resources, sheets, login: email => { current = email; }, busy: value => { held = value; } };
}

test('編譯後 GAS：空身分拒絕；初始化只建新私人資源且可重入', () => {
  const env = environment(); env.login('');
  assert.equal(env.call('setup').error.code, 'SETUP_OWNER_REQUIRED');
  assert.equal(env.resources.size, 0);
  env.login('owner@example.invalid'); assert.equal(env.call('setup').ok, true);
  assert.equal(env.call('setup').ok, true); assert.equal(env.resources.size, 2);
  const result = env.call('rpc', { action: 'bootstrap' });
  assert.equal(result.data.viewer.id, 'sandbox-owner');
  assert.equal(result.data.capabilities.switchActors, false);
  assert.equal(result.data.capabilities.line, false);
  assert.ok(!JSON.stringify(result).includes('owner@example.invalid'));
  env.login('other@example.invalid');
  assert.equal(env.call('rpc', { action: 'bootstrap' }).error.code, 'NOT_ALLOWLISTED');
  env.login(''); assert.equal(env.call('rpc', { action: 'bootstrap' }).error.code, 'GOOGLE_IDENTITY_UNAVAILABLE');
});

test('編譯後 GAS：寫入讀回、同 ID 重送、不能冒名與自己確認；分享改公開即拒絕', () => {
  const env = environment(); env.call('setup');
  const command = { type: 'inspect', requestId: 'google-inspect-0001', requirementId: 'REQ-FORK-D',
    templateVersion: 1, period: '2026-10-06', actualAt: '2026-10-06T15:00:00+08:00', signatureRef: 'FAKE-SIGNATURE',
    answers: { BRAKE: { result: 'normal', note: '' }, HORN: { result: 'abnormal', note: '隔離測試' } } };
  const submitted = env.call('rpc', { action: 'execute', command });
  assert.equal(submitted.data.status, 'complete');
  assert.deepEqual(env.call('rpc', { action: 'execute', command }), submitted);
  let dashboard = env.call('rpc', { action: 'bootstrap' }).data;
  assert.equal(dashboard.records.length, 1); assert.equal(dashboard.cases.length, 1);
  const id = dashboard.cases[0].id;
  const claim = env.call('rpc', { action: 'execute', command: { type: 'claim', requestId: 'google-claim-0001',
    caseId: id, expectedStatus: 'pending', expectedVersion: 1 } });
  assert.equal(claim.ok, true);
  assert.equal(env.call('rpc', { action: 'execute', command: { type: 'report', requestId: 'google-report-0001',
    caseId: id, expectedStatus: 'in_progress', expectedVersion: 2,
    description: '示範處理', completedDate: '2026-10-06' } }).ok, true);
  assert.equal(env.call('rpc', { action: 'execute', command: { type: 'confirm', requestId: 'google-confirm-0001',
    caseId: id, expectedStatus: 'awaiting_confirmation', expectedVersion: 3, comment: '示範確認' } }).error.code,
  'SELF_CONFIRMATION_DENIED');
  assert.equal(env.call('rpc', { action: 'bootstrap', actorId: 'demo-admin' }).error.code, 'REQUEST_INVALID');
  env.busy(true); assert.equal(env.call('rpc', { action: 'bootstrap' }).error.code, 'BUSY'); env.busy(false);
  const file = env.resources.get(env.props.get('KIT_STATE_SHEET')); file.getSharingAccess = () => 'ANYONE';
  assert.equal(env.call('rpc', { action: 'bootstrap' }).error.code, 'RESOURCE_NOT_PRIVATE');
});

test('部署 manifest 僅擁有者存取，無 LINE／外部請求範圍與觸發器入口', () => {
  const manifest = JSON.parse(readFileSync(new URL('../gas/appsscript.json', import.meta.url), 'utf8'));
  assert.equal(manifest.webapp.access, 'MYSELF');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.ok(!manifest.oauthScopes.some(scope => scope.includes('external_request')));
  assert.ok(!source.includes('UrlFetchApp'));
  assert.ok(!source.includes('ScriptApp.newTrigger'));
});
