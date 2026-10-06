import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/adapters/memory.mjs';
import { fixture, example, inspection, event, context, code } from './helpers.mjs';

function caseAction(service, caseId, type, actor, fields = {}) {
  const { item } = service.caseDetails(context(actor), caseId);
  return service.execute(context(actor), { requestId: 'test-' + type + '-0001', type, caseId,
    expectedStatus: item.status, expectedVersion: item.version, ...fields });
}

test('同 ID 檢查重送不多寫紀錄、案件、歷程或通知', () => {
  const { service, repository } = fixture();
  const first = service.execute(context(), inspection());
  assert.deepEqual(service.execute(context(), inspection()), first);
  for (const table of ['records', 'cases', 'history', 'notifications', 'archives']) assert.equal(repository.list(table).length, 1);
});

test('同 ID 換內容或換操作者拒絕，假前端身分也拒絕', () => {
  const { service } = fixture(); service.execute(context(), inspection());
  const changed = inspection(); changed.answers.HORN.note = '不同內容';
  assert.throws(() => service.execute(context(), changed), code('REQUEST_CONTENT_CONFLICT'));
  assert.throws(() => service.execute(context('demo-handler'), inspection()), code('REQUEST_CONTENT_CONFLICT'));
  assert.throws(() => service.execute({ personId: 'demo-inspector' }, inspection()), code('IDENTITY_UNVERIFIED'));
});

test('再次發現併原案並推進版本，但不重推通知', () => {
  const { service, repository } = fixture();
  const first = service.execute(context(), inspection());
  const second = service.execute(context(), inspection({ requestId: 'test-inspect-0002' }));
  assert.deepEqual(second.caseIds, first.caseIds);
  assert.equal(repository.list('cases').length, 1);
  assert.equal(repository.list('cases')[0].version, 2);
  assert.equal(repository.list('history').length, 2);
  assert.equal(repository.list('notifications').length, 1);
  assert.equal(service.dashboard(context('demo-admin')).uniqueCompletedRequirements, 1);
});

test('未結異常不能下一次直接勾正常', () => {
  const { service } = fixture(); service.execute(context(), inspection());
  const command = inspection({ requestId: 'test-normal-0001' }); command.answers.HORN.result = 'normal';
  assert.throws(() => service.execute(context(), command), code('OPEN_ISSUE_CANNOT_BE_NORMAL'));
});

test('完整接案、回報、確認，主管管理權不是確認權', () => {
  const { service, repository } = fixture();
  const id = service.execute(context(), inspection()).caseIds[0];
  assert.throws(() => caseAction(service, id, 'claim', 'demo-admin'), code('FORBIDDEN'));
  caseAction(service, id, 'claim', 'demo-handler');
  caseAction(service, id, 'report', 'demo-handler', { description: '示範處理內容', completedDate: '2026-10-05' });
  assert.throws(() => caseAction(service, id, 'confirm', 'demo-admin', { comment: '管理者直接結案' }), code('FORBIDDEN'));
  caseAction(service, id, 'confirm', 'demo-confirm', { comment: '示範確認' });
  assert.equal(service.caseDetails(context(), id).item.status, 'closed');
  assert.equal(repository.list('history').length, 4);
  assert.equal(repository.list('notifications').length, 2);
});

test('兩人用同版本接案只有第一筆受理，過期確認也拒絕', () => {
  const config = example(); config.people.push({ ...config.people[1], id: 'demo-other' });
  const { service } = fixture(config); const id = service.execute(context(), inspection()).caseIds[0];
  const command = { type: 'claim', requestId: 'test-claim-0001', caseId: id, expectedStatus: 'pending', expectedVersion: 1 };
  service.execute(context('demo-handler'), command);
  assert.throws(() => service.execute(context('demo-other'), { ...command, requestId: 'test-claim-0002' }), code('VERSION_CONFLICT'));
});

test('處理人失格可合法接手，未讀 LINE 不能成為接手理由', () => {
  const config = example(); config.people.push({ ...config.people[1], id: 'demo-other' });
  const { service, repository } = fixture(config); const id = service.execute(context(), inspection()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  assert.throws(() => caseAction(service, id, 'takeover', 'demo-other', { reason: '對方未讀' }), code('HANDLER_STILL_ELIGIBLE'));
  service.config.people[1].active = false;
  caseAction(service, id, 'takeover', 'demo-other', { reason: '原處理人已停用' });
  caseAction(service, id, 'report', 'demo-other', { description: '接手處理完成', completedDate: '2026-10-05' });
  assert.equal(service.caseDetails(context(), id).item.handlerId, 'demo-other');
  assert.equal(repository.list('notifications').length, 2);
  service.config.people[1].active = true;
  assert.throws(() => caseAction(service, id, 'report', 'demo-handler', {
    requestId: 'test-old-report-0002', description: '舊人回報', completedDate: '2026-10-05'
  }), code('NOT_CURRENT_HANDLER'));
});

test('兼任處理與確認預設拒絕', () => {
  const config = example(); config.people[1].roles.push('confirm');
  const { service } = fixture(config); const id = service.execute(context(), inspection()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  caseAction(service, id, 'report', 'demo-handler', { description: '完成', completedDate: '2026-10-05' });
  assert.throws(() => caseAction(service, id, 'confirm', 'demo-handler', { comment: '自行確認' }), code('SELF_CONFIRMATION_DENIED'));
});

test('事件連點不多建案，查看仍查場域', () => {
  const { service, repository } = fixture(); const first = service.execute(context(), event());
  assert.deepEqual(service.execute(context(), event()), first);
  assert.equal(repository.list('cases').length, 1);
  service.config.people[0].sites = ['SITE-B'];
  assert.throws(() => service.caseDetails(context(), first.caseIds[0]), code('FORBIDDEN'));
  assert.equal(service.dashboard(context()).cases.length, 0);
});

test('資料已寫但標記未完成，中斷後同意圖可續作並核對實際列', () => {
  const { service, repository } = fixture();
  let once = false;
  repository.afterWrite = table => {
    if (table === 'cases' && !once) { once = true; throw new Error('假配額中斷'); }
  };
  assert.throws(() => service.execute(context(), inspection()), code('SYNC_PENDING'));
  assert.equal(service.dashboard(context('demo-admin')).cases[0].syncing, true);
  assert.equal(service.dashboard(context()).records.length, 0);
  const restarted = fixture(example(), new MemoryRepository(repository.snapshot()));
  const result = restarted.service.execute(context(), inspection());
  assert.equal(result.status, 'complete');
  for (const table of ['records', 'cases', 'history', 'notifications']) assert.equal(restarted.repository.list(table).length, 1);
});

test('未完成意圖保留時，另一動作不可插入或新增同項案件', () => {
  const { service, repository } = fixture(); let once = false;
  repository.afterWrite = table => { if (table === 'records' && !once) { once = true; throw new Error('中斷'); } };
  assert.throws(() => service.execute(context(), inspection()), code('SYNC_PENDING'));
  assert.throws(() => service.execute(context(), inspection({ requestId: 'test-inspect-0002' })), code('SYNC_PENDING'));
  assert.equal(repository.list('cases').length, 0);
  service.execute(context(), inspection());
  assert.equal(repository.list('cases').length, 1);
});

test('內容衝突凍結並列人工修復，已有副作用不得作廢', () => {
  const { service, repository } = fixture(); let once = false;
  repository.afterWrite = table => { if (table === 'cases' && !once) { once = true; throw new Error('中斷'); } };
  assert.throws(() => service.execute(context(), inspection()), code('SYNC_PENDING'));
  const item = repository.list('cases')[0]; item.version = 99; repository.put('cases', item.id, item);
  assert.throws(() => service.execute(context(), inspection()), code('RECOVERY_REQUIRED'));
  const report = service.recoveryReport(context('demo-admin'), inspection().requestId);
  assert.equal(report.manualResolutionRequired, true); assert.equal(report.canVoid, false);
  assert.throws(() => service.voidUnusedIntent(context('demo-admin'), report.requestId, {
    maintenanceId: 'test-maint-0001', reason: '不能把副作用隱藏', reportDigest: report.reportDigest
  }), code('SIDE_EFFECTS_PREVENT_VOID'));
});

test('零副作用意圖可受控作廢，舊 ID 不復活，新的真實操作可繼續', () => {
  const { service, repository } = fixture(); let once = false;
  repository.afterWrite = table => { if (table === 'operations' && !once) { once = true; throw new Error('中斷'); } };
  assert.throws(() => service.execute(context(), inspection()), /中斷/);
  const report = service.recoveryReport(context('demo-admin'), inspection().requestId);
  assert.equal(report.canVoid, true);
  const args = { maintenanceId: 'test-maint-0001', reason: '取消未使用測試意圖', reportDigest: report.reportDigest };
  assert.equal(service.voidUnusedIntent(context('demo-admin'), report.requestId, args).status, 'voided');
  assert.equal(service.voidUnusedIntent(context('demo-admin'), report.requestId, args).status, 'voided');
  assert.equal(service.execute(context(), inspection()).status, 'voided');
  assert.equal(service.execute(context(), inspection({ requestId: 'test-inspect-0002' })).status, 'complete');
});

test('過期修復報告、無管理權及拿不到鎖都拒絕', () => {
  const { service, repository } = fixture(); let once = false;
  repository.afterWrite = table => { if (table === 'operations' && !once) { once = true; throw new Error('中斷'); } };
  assert.throws(() => service.execute(context(), event()), /中斷/);
  const report = service.recoveryReport(context('demo-admin'), event().requestId);
  assert.throws(() => service.recoveryReport(context(), report.requestId), code('FORBIDDEN'));
  assert.throws(() => service.voidUnusedIntent(context('demo-admin'), report.requestId, {
    maintenanceId: 'test-maint-0001', reason: '過期報告', reportDigest: 'OLD'
  }), code('REPORT_STALE'));
  repository.busy = true;
  assert.throws(() => service.execute(context(), event()), code('BUSY'));
  repository.busy = false;
});

test('作廢後審計完成前中斷，同維護 ID 可續作且不偽造原動作', () => {
  const { service, repository } = fixture(); let once = false;
  repository.afterWrite = table => { if (table === 'operations' && !once) { once = true; throw new Error('受理中斷'); } };
  assert.throws(() => service.execute(context(), event()), /受理中斷/);
  const report = service.recoveryReport(context('demo-admin'), event().requestId);
  const args = { maintenanceId: 'test-maint-0001', reason: '測試作廢', reportDigest: report.reportDigest };
  let crashed = false;
  repository.afterWrite = table => { if (table === 'operations' && !crashed) { crashed = true; throw new Error('作廢中斷'); } };
  assert.throws(() => service.voidUnusedIntent(context('demo-admin'), report.requestId, args), /作廢中斷/);
  assert.equal(service.voidUnusedIntent(context('demo-admin'), report.requestId, args).status, 'voided');
  assert.equal(repository.list('maintenance')[0].status, 'complete');
  assert.equal(repository.list('cases').length, 0);
});

test('持續中斷有有限重試上限，不會無限掃描', () => {
  const { service, repository } = fixture();
  repository.afterWrite = table => { if (table === 'records') throw new Error('中斷'); };
  assert.throws(() => service.execute(context(), inspection()), code('SYNC_PENDING'));
  repository.afterWrite = table => { if (table === 'history') throw new Error('中斷'); };
  assert.throws(() => service.execute(context(), inspection()), code('SYNC_PENDING'));
  repository.afterWrite = table => { if (table === 'notifications') throw new Error('中斷'); };
  assert.throws(() => service.execute(context(), inspection()), code('RECOVERY_REQUIRED'));
  assert.throws(() => service.execute(context(), inspection()), code('RECOVERY_REQUIRED'));
});

test('確認前有新的異常發現，舊版本不能結案', () => {
  const { service } = fixture(); const id = service.execute(context(), inspection()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  caseAction(service, id, 'report', 'demo-handler', { description: '處理完成', completedDate: '2026-10-05' });
  service.execute(context(), inspection({ requestId: 'test-rediscover-0002' }));
  assert.throws(() => service.execute(context('demo-confirm'), { requestId: 'test-confirm-0001',
    type: 'confirm', caseId: id, expectedStatus: 'awaiting_confirmation', expectedVersion: 3,
    comment: '舊畫面確認' }), code('VERSION_CONFLICT'));
});

test('結案現況先寫、歷程未完成，對外必須顯示同步中', () => {
  const { service, repository } = fixture(); const id = service.execute(context(), inspection()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  caseAction(service, id, 'report', 'demo-handler', { description: '處理完成', completedDate: '2026-10-05' });
  let once = false;
  repository.afterWrite = table => { if (table === 'cases' && !once) { once = true; throw new Error('中斷'); } };
  assert.throws(() => caseAction(service, id, 'confirm', 'demo-confirm', { comment: '確認' }), code('SYNC_PENDING'));
  assert.equal(service.caseDetails(context('demo-viewer'), id).item.status, 'syncing');
  assert.equal(service.dashboard(context('demo-admin')).cases.filter(row => row.status === 'closed').length, 0);
});

test('退回及重開均有原因與歷程，不把處理完成當結案', () => {
  const { service, repository } = fixture(); const id = service.execute(context(), event()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  caseAction(service, id, 'report', 'demo-handler', { description: '第一次處理', completedDate: '2026-10-05' });
  assert.equal(service.caseDetails(context(), id).item.status, 'awaiting_confirmation');
  assert.throws(() => caseAction(service, id, 'return', 'demo-confirm', { reason: '' }), code('REASON_REQUIRED'));
  caseAction(service, id, 'return', 'demo-confirm', { reason: '補充處理' });
  caseAction(service, id, 'report', 'demo-handler', { requestId: 'test-report-0002',
    description: '補充處理完成', completedDate: '2026-10-05' });
  caseAction(service, id, 'confirm', 'demo-confirm', { comment: '確認完成' });
  caseAction(service, id, 'reopen', 'demo-confirm', { reason: '原問題仍存在' });
  assert.equal(service.caseDetails(context(), id).item.status, 'in_progress');
  assert.equal(repository.list('history').length, 7);
  assert.equal(repository.list('notifications').length, 5);
});

test('處理日期不得早於開案，停用人員不能查詢', () => {
  const { service } = fixture(); const id = service.execute(context(), inspection()).caseIds[0];
  caseAction(service, id, 'claim', 'demo-handler');
  assert.throws(() => caseAction(service, id, 'report', 'demo-handler', {
    description: '錯誤日期', completedDate: '2026-10-04'
  }), code('COMPLETION_DATE_BEFORE_CASE'));
  service.config.people[0].active = false;
  assert.throws(() => service.caseDetails(context(), id), code('PERSON_INACTIVE'));
});
