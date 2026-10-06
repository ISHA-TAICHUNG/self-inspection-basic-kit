import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/domain/config.mjs';
import { previewRecipients, recheckRecipients, classifyResponse } from '../src/domain/notifications.mjs';
import { productionAdapters } from '../src/adapters/production.mjs';
import { example, fixture, inspection, context, code, NOW } from './helpers.mjs';

test('虛構設定可以驗證，正式模式一律拒絕', () => {
  assert.equal(validateConfig(example()).schemaVersion, 1);
  const config = example(); config.mode = 'production';
  assert.throws(() => validateConfig(config), code('PRODUCTION_NOT_IMPLEMENTED'));
  for (const adapter of Object.values(productionAdapters)) assert.throws(adapter, code('PRODUCTION_NOT_IMPLEMENTED'));
});

for (const [name, mutate, expected] of [
  ['未知 schema', config => { config.schemaVersion = 99; }, 'SCHEMA_UNSUPPORTED'],
  ['空通知範圍', config => { config.notificationRules[0].scope = {}; }, 'RULE_SCOPE_REQUIRED'],
  ['重複設備編號', config => { config.equipment[1].id = config.equipment[0].id; }, 'DUPLICATE_ID'],
  ['範本引用不存在', config => { config.requirements[0].templateId = 'MISSING'; }, 'REQUIREMENT_INVALID'],
  ['無有效確認人', config => { config.people[2].active = false; }, 'ROLE_COVERAGE_MISSING'],
  ['禁止放入真實 LINE userId', config => { config.people[1].lineBinding = 'U' + '0'.repeat(32); }, 'SANDBOX_BINDING_ONLY'],
  ['不存在的停工日期', config => { config.calendar.closedDates = ['2026-02-30']; }, 'CALENDAR_INVALID']
]) {
  test(name, () => { const config = example(); mutate(config); assert.throws(() => validateConfig(config), code(expected)); });
}

test('私有草稿也不接受巢狀密鑰欄位', () => {
  const config = example(); const key = 'password';
  config.people[0][key] = 'FAKE-NOT-A-CREDENTIAL';
  assert.throws(() => validateConfig(config), code('SECRET_IN_CONFIG'));
});

test('收件限定指定角色，沒有通知規則不全員發送', () => {
  const config = example();
  const item = { id: 'CASE-01', siteId: 'SITE-A', equipmentId: 'EQ-FORK-01', reporterId: 'demo-inspector', urgency: 'general' };
  assert.deepEqual(previewRecipients(config, item, 'opened', NOW).eligible.map(row => row.personId), ['demo-handler', 'demo-confirm']);
  config.notificationRules = [];
  const result = previewRecipients(config, item, 'opened', NOW);
  assert.equal(result.eligible.length, 0); assert.equal(result.reason, 'no_rule');
});

test('停用、到期、跨場域與未綁定人員排除，重綁不偷換原名單', () => {
  const config = example();
  const item = { siteId: 'SITE-A', reporterId: 'demo-inspector', urgency: 'general' };
  const task = { event: 'opened', originalRecipients: previewRecipients(config, item, 'opened', NOW).eligible };
  config.people[1].lineBinding = 'FAKE-BINDING-NEW';
  config.people[2].active = false;
  assert.equal(recheckRecipients(config, task, item, NOW).length, 0);
  config.people[1].lineBinding = null;
  config.people[2].active = true; config.people[2].expiresAt = '2026-10-05T07:00:00Z';
  assert.equal(previewRecipients(config, item, 'opened', NOW).eligible.length, 0);
  config.people[1].lineBinding = 'FAKE-BINDING-H'; config.people[1].sites = ['SITE-B'];
  assert.equal(previewRecipients(config, item, 'opened', NOW).eligible.length, 0);
});

test('新增人員不能加入原通知，退回只通知現任處理人', () => {
  const config = example();
  const item = { siteId: 'SITE-A', urgency: 'general', handlerId: 'demo-handler' };
  const task = { event: 'opened', originalRecipients: previewRecipients(config, item, 'opened', NOW).eligible };
  config.people.push({ ...config.people[1], id: 'demo-new-handler', lineBinding: 'FAKE-BINDING-N' });
  assert.equal(recheckRecipients(config, task, item, NOW).length, 2);
  assert.deepEqual(previewRecipients(config, item, 'returned', NOW).eligible.map(row => row.personId), ['demo-handler']);
  item.handlerId = 'demo-new-handler';
  assert.equal(recheckRecipients(config, { event: 'returned', originalRecipients: [task.originalRecipients[0]] }, item, NOW).length, 0);
});

test('逾時後的 401／未知 429 不能抹除不明結果', () => {
  const timeout = classifyResponse({ status: 'pending' }, { status: 0 });
  assert.equal(timeout.possibleAcceptance, true);
  assert.equal(classifyResponse(timeout, { status: 401 }).status, 'unknown');
  assert.equal(classifyResponse(timeout, { status: 429 }).status, 'unknown');
});

test('409 需接受 ID，已接受永不因後續錯誤改回重試', () => {
  assert.equal(classifyResponse({}, { status: 409 }).status, 'unknown');
  const accepted = classifyResponse({}, { status: 409, acceptedRequestId: 'FAKE-ACCEPTED' });
  assert.equal(accepted.status, 'api_accepted');
  assert.deepEqual(classifyResponse(accepted, { status: 500 }), accepted);
  assert.equal(classifyResponse({}, { status: 429, category: 'rate_limit' }).status, 'retry_pending');
  assert.equal(classifyResponse({}, { status: 429, category: 'quota' }).status, 'needs_configuration');
});

for (const [name, mutate, expected] of [
  ['未填答案', command => { command.answers.HORN.result = ''; }, 'ANSWER_REQUIRED'],
  ['異常無說明', command => { command.answers.HORN.note = ''; }, 'NOTE_REQUIRED'],
  ['不適用無原因', command => { command.answers.HORN = { result: 'not_applicable', note: '' }; }, 'NOTE_REQUIRED'],
  ['沒有簽名引用', command => { command.signatureRef = ''; }, 'SIGNATURE_REQUIRED'],
  ['範本版本不符', command => { command.templateVersion = 2; }, 'TEMPLATE_VERSION_CONFLICT'],
  ['期間不是實際檢查日', command => { command.period = '2026-10-04'; }, 'PERIOD_MISMATCH'],
  ['未來檢查時間', command => { command.actualAt = '2026-10-05T17:00:00+08:00'; }, 'ACTUAL_TIME_INVALID'],
  ['時間沒有時區', command => { command.actualAt = '2026-10-05T15:00:00'; }, 'ACTUAL_TIME_INVALID'],
  ['偽造檢查人參數', command => { command.actorId = 'demo-admin'; }, 'UNEXPECTED_COMMAND_FIELD'],
  ['尚未實作的照片不能假裝保存', command => { command.answers.HORN.photos = ['PHOTO-1']; }, 'PHOTO_ADAPTER_NOT_IMPLEMENTED']
]) {
  test(name, () => {
    const { service, repository } = fixture(); const command = inspection(); mutate(command);
    assert.throws(() => service.execute(context(), command), code(expected));
    assert.equal(repository.list('records').length, 0);
  });
}

test('停工日無日檢需求，月檢不與日檢互抵', () => {
  const config = example(); config.calendar.closedDates = ['2026-10-05'];
  const { service } = fixture(config);
  assert.throws(() => service.execute(context(), inspection()), code('NO_REQUIREMENT_TODAY'));
  service.execute(context(), inspection({ requirementId: 'REQ-FORK-M', period: '2026-10',
    answers: { BATTERY: { result: 'normal', note: '' } } }));
  assert.equal(service.dashboard(context('demo-admin')).uniqueCompletedRequirements, 1);
});
