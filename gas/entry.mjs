import example from '../config/example.json';
import { KitError, requireValue, canonical, digest } from '../src/domain/common.mjs';
import { KitService } from '../src/application/service.mjs';
import { webState } from '../src/application/view.mjs';
import { googleIdentity } from '../src/adapters/google-identity.mjs';
import { ChunkedRepository, STORE_HEADER } from '../src/adapters/chunked.mjs';

// GAS V8 不提供 Node 的 structuredClone；本套件只接受可序列化 JSON。
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
if (!Array.prototype.toReversed) Array.prototype.toReversed = function() { return this.slice().reverse(); };
if (!Array.prototype.toSorted) Array.prototype.toSorted = function(compare) { return this.slice().sort(compare); };

const CAPABILITIES = { environment: 'google_owner_sandbox', switchActors: false,
  storage: 'private_sheets_trial', pdf: 'private_demo_pdf', line: false,
  photos: false, signatures: false, production: false };

function properties() { return PropertiesService.getScriptProperties(); }
function activeEmail() { return Session.getActiveUser().getEmail().trim().toLowerCase(); }

function scriptLock(fn) {
  const lock = LockService.getScriptLock();
  requireValue(lock.tryLock(1000), 'BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}

function privateResource(id, folder = false) {
  const resource = folder ? DriveApp.getFolderById(id) : DriveApp.getFileById(id);
  requireValue(resource.getSharingAccess() === DriveApp.Access.PRIVATE, 'RESOURCE_NOT_PRIVATE');
  requireValue(resource.getOwner().getEmail().toLowerCase() ===
    Session.getEffectiveUser().getEmail().toLowerCase(), 'RESOURCE_OWNER_MISMATCH');
  return resource;
}

function cloudConfig() {
  const config = structuredClone(example);
  config.configVersion = 'OWNER-TRIAL-1';
  config.organization = '示範事業單位（隔離試行）';
  config.people.push({ id: 'sandbox-owner', label: '測試管理者',
    roles: ['inspect', 'handle', 'confirm', 'view', 'admin'], sites: ['SITE-A'], active: true, lineBinding: null });
  return config;
}

function storage() {
  const id = properties().getProperty('KIT_STATE_SHEET');
  requireValue(id, 'SETUP_REQUIRED');
  privateResource(id);
  const spreadsheet = SpreadsheetApp.openById(id);
  const sheet = spreadsheet.getSheetByName('Store');
  requireValue(sheet && canonical(sheet.getRange(1, 1, 1, 7).getValues()[0]) ===
    canonical(STORE_HEADER), 'STORE_SCHEMA_UNSUPPORTED');
  const readRows = () => sheet.getLastRow() <= 1 ? [] :
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  return new ChunkedRepository({ readRows, appendRows: rows =>
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows),
  withLock: scriptLock, flush: () => SpreadsheetApp.flush() });
}

function service() {
  const bindings = JSON.parse(properties().getProperty('KIT_GOOGLE_BINDINGS') ?? '{}');
  const identity = googleIdentity(activeEmail(), bindings);
  identity.authenticate();
  return new KitService({ config: cloudConfig(), identity, repository: storage() });
}

export function setup() {
  try {
    const email = activeEmail();
    requireValue(email && email === Session.getEffectiveUser().getEmail().toLowerCase(), 'SETUP_OWNER_REQUIRED');
    return scriptLock(() => {
      const props = properties();
      const owner = props.getProperty('KIT_SETUP_OWNER');
      requireValue(!owner || owner === email, 'SETUP_OWNER_REQUIRED');
      props.setProperty('KIT_SETUP_OWNER', email);
      if (!props.getProperty('KIT_STATE_SHEET')) {
        const sheet = SpreadsheetApp.create('ISHA 基礎套件｜隔離測試資料');
        props.setProperty('KIT_STATE_SHEET', sheet.getId());
      }
      const spreadsheet = SpreadsheetApp.openById(props.getProperty('KIT_STATE_SHEET'));
      privateResource(spreadsheet.getId());
      spreadsheet.setSpreadsheetTimeZone('Asia/Taipei');
      let sheet = spreadsheet.getSheetByName('Store');
      if (!sheet) sheet = spreadsheet.insertSheet('Store');
      if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, 7).setValues([STORE_HEADER]);
      requireValue(canonical(sheet.getRange(1, 1, 1, 7).getValues()[0]) === canonical(STORE_HEADER),
        'STORE_SCHEMA_UNSUPPORTED');
      if (!props.getProperty('KIT_PDF_FOLDER')) {
        const folder = DriveApp.createFolder('ISHA 基礎套件｜隔離示範 PDF');
        props.setProperty('KIT_PDF_FOLDER', folder.getId());
      }
      privateResource(props.getProperty('KIT_PDF_FOLDER'), true);
      if (!props.getProperty('KIT_GOOGLE_BINDINGS')) {
        props.setProperty('KIT_GOOGLE_BINDINGS', JSON.stringify({ [email]: 'sandbox-owner' }));
      }
      SpreadsheetApp.flush();
      return { ok: true, data: { initialized: true, lineEnabled: false, production: false } };
    });
  } catch (error) { return failure(error); }
}

const escape = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function reportHtml(record, actorLabel) {
  const check = record.inspection;
  const result = { normal: '正常', abnormal: '異常', not_applicable: '不適用' };
  const rows = check.template.items.map((item, index) => `<tr><td>${index + 1}</td>` +
    `<td>${escape(item.label)}</td><td>${result[check.answers[item.id].result]}</td>` +
    `<td>${escape(check.answers[item.id].note)}</td></tr>`).join('');
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;color:#173b33;margin:36px;font-size:12px}' +
    'h1{font-size:23px}table{border-collapse:collapse;width:100%;margin:24px 0}' +
    'th,td{border:1px solid #899b94;padding:10px;text-align:left}th{background:#edf4f0}' +
    '.label{color:#9b5b09;font-weight:bold;font-size:15px}footer{margin-top:32px;color:#596b63}' +
    '</style></head><body><p class="label">隔離示範｜非正式檢查紀錄</p>' +
    `<h1>${check.requirement.cycle === 'daily' ? '每日' : '每月'}檢查示範表</h1>` +
    `<p>設備：${escape(check.equipment.name)}　期間：${escape(check.period)}</p>` +
    `<p>填報角色：${escape(actorLabel)}　檢查時間：${escape(check.actualAt)}</p>` +
    '<table><thead><tr><th>項次</th><th>檢查項目</th><th>結果</th><th>備註</th></tr></thead>' +
    `<tbody>${rows}</tbody></table><p>簽名：示範引用，非本人電子簽名。</p>` +
    `<footer>紀錄編號：${escape(record.id)}<br>僅使用虛構項目驗證流程，非完整核定檢查表。</footer>` +
    '</body></html>';
}

function pdf(serviceInstance, recordId) {
  return serviceInstance.repository.withLock(() => {
    const record = serviceInstance.dashboard({}).records.find(row => row.id === recordId);
    requireValue(record, 'FORBIDDEN');
    const repo = serviceInstance.repository;
    const folder = privateResource(properties().getProperty('KIT_PDF_FOLDER'), true);
    const recordDigest = digest(record);
    const name = 'DEMO-' + record.id + '.pdf';
    let saved = repo.get('files', record.id);
    let file;
    if (saved) {
      requireValue(saved.recordDigest === recordDigest, 'PDF_CONTENT_CONFLICT');
      file = privateResource(saved.fileId);
    } else {
      const existing = folder.getFilesByName(name);
      if (existing.hasNext()) {
        file = existing.next();
        requireValue(!existing.hasNext(), 'FILE_RECONCILIATION_REQUIRED');
        const description = JSON.parse(file.getDescription() || '{}');
        requireValue(description.recordDigest === recordDigest, 'FILE_RECONCILIATION_REQUIRED');
      } else {
        const label = serviceInstance.config.people.find(person => person.id === record.reporterId)?.label;
        const blob = HtmlService.createHtmlOutput(reportHtml(record, label)).getBlob()
          .getAs(MimeType.PDF).setName(name);
        file = folder.createFile(blob);
        file.setDescription(JSON.stringify({ recordDigest, environment: 'isolated_trial' }));
      }
      privateResource(file.getId());
      saved = { id: record.id, recordDigest, fileId: file.getId(), name,
        checksum: byteDigest(file.getBlob().getBytes()) };
      repo.ensure('files', record.id, saved);
    }
    const bytes = file.getBlob().getBytes();
    requireValue(bytes.length <= 5000000 && bytes.slice(0, 5).map(byte => String.fromCharCode(byte))
      .join('') === '%PDF-', 'PDF_INVALID');
    requireValue(byteDigest(bytes) === saved.checksum, 'PDF_CONTENT_CONFLICT');
    return { name, mime: 'application/pdf', base64: Utilities.base64Encode(bytes), demonstration: true };
  });
}

function byteDigest(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function failure(error) {
  return { ok: false, error: { code: error instanceof KitError ? error.code : 'INTERNAL_ERROR' } };
}

export function rpc(payload) {
  try {
    requireValue(payload && typeof payload === 'object' && !Array.isArray(payload) &&
      JSON.stringify(payload).length <= 120000, 'REQUEST_INVALID');
    requireValue(Object.keys(payload).every(key => ['action', 'command', 'id'].includes(key)), 'REQUEST_INVALID');
    if (payload.action === 'bootstrap' && !properties().getProperty('KIT_STATE_SHEET')) {
      requireValue(activeEmail() && activeEmail() === Session.getEffectiveUser().getEmail().toLowerCase(),
        'SETUP_OWNER_REQUIRED');
      return { ok: true, data: { setupRequired: true } };
    }
    const app = service();
    let data;
    switch (payload.action) {
      case 'bootstrap': data = app.repository.withLock(() => webState(app, {}, CAPABILITIES)); break;
      case 'execute': data = app.execute({}, payload.command); break;
      case 'case': data = app.repository.withLock(() => app.caseDetails({}, payload.id)); break;
      case 'preview': data = app.repository.withLock(() => app.notificationPreview({}, payload.id)); break;
      case 'pdf': data = pdf(app, payload.id); break;
      default: requireValue(false, 'ACTION_NOT_SUPPORTED');
    }
    return { ok: true, data };
  } catch (error) { return failure(error); }
}
