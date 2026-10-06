import { createIcons, ClipboardCheck, CircleAlert, LayoutDashboard, Wrench, Send, X,
  RotateCw, RefreshCw, Database, Siren, FileDown, Eye } from 'lucide';

const icons = { ClipboardCheck, CircleAlert, LayoutDashboard, Wrench, Send, X, RotateCw,
  RefreshCw, Database, Siren, FileDown, Eye };
const $ = id => document.getElementById(id);
const stateNames = { pending: '待處理', reported: '已通報', in_progress: '處理中',
  awaiting_confirmation: '待確認', closed: '已結案', syncing: '同步中' };
const actionNames = { claim: '接案', takeover: '接手', report: '回報完成', confirm: '確認結案',
  return: '退回補正', reopen: '重新開案', opened: '建立案件', reported: '建立通報', rediscovered: '再次發現' };
const errors = { FORBIDDEN: '目前身分無此操作權限。', VERSION_CONFLICT: '案件已有更新，請重開案件確認最新內容。',
  NOTE_REQUIRED: '異常或不適用項目必須填寫備註。', NO_REQUIREMENT_TODAY: '今天沒有此日檢需求。',
  OPEN_ISSUE_CANNOT_BE_NORMAL: '此項目尚有未結異常，不能直接改填正常。',
  SELF_CONFIRMATION_DENIED: '處理人不能確認自己的處置，須由另一位有資格者確認。',
  GOOGLE_IDENTITY_UNAVAILABLE: 'Google 未提供目前登入身分，已拒絕操作。', NOT_ALLOWLISTED: '此 Google 帳號不在核定名單。',
  SETUP_OWNER_REQUIRED: '只允許測試專案擁有者初始化。', SYNC_PENDING: '部分步驟未完成，請重試原操作。',
  RECOVERY_REQUIRED: '操作需人工核對，暫停後續動作。', STORE_RECOVERY_REQUIRED: '本機保存失敗，已停止寫入。',
  PERSON_INACTIVE: '人員已停用或資格到期。', BUSY: '資料正在處理，請稍後重試。',
  RESOURCE_NOT_PRIVATE: '測試資源分享權限不符合私人要求，已停止操作。',
  FILE_RECONCILIATION_REQUIRED: 'PDF 檔案需核對，沒有新增重複檔。', PDF_DEPENDENCY_UNAVAILABLE: '示範 PDF 產製套件尚未安裝。' };
let state, csrf, pending, selectedCase, busy = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function icon(name) { const node = element('i'); node.dataset.lucide = name; return node; }
function refreshIcons() { createIcons({ icons }); }
function button(label, glyph, handler) {
  const node = element('button'); node.type = 'button'; node.append(icon(glyph), document.createTextNode(label));
  node.addEventListener('click', handler); return node;
}
function notice(text, isError = false) {
  $('message').textContent = text; $('message').className = isError ? 'error' : ''; $('message').hidden = false;
  if ($('case-dialog').open) {
    $('dialog-message').textContent = text;
    $('dialog-message').className = isError ? 'error' : '';
    $('dialog-message').hidden = false;
  }
}
function fail(error) { notice(errors[error.code] ?? `操作未完成（${error.code ?? 'NETWORK_ERROR'}）。`, true); }

async function rpc(payload) {
  if (globalThis.google?.script?.run) {
    return new Promise((resolve, reject) => google.script.run.withSuccessHandler(result => {
      if (result.ok) resolve(result.data); else reject(result.error);
    }).withFailureHandler(() => reject({ code: 'NETWORK_ERROR' })).kitRpc(payload));
  }
  const response = await fetch('/api/rpc', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Kit-CSRF': csrf ?? '' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!result.ok) throw result.error;
  return result.data;
}

function dateText(value) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: state?.timeZone ?? 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(value));
}
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: state.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(state.updatedAt));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function showView(id) {
  document.querySelectorAll('.view').forEach(node => { node.hidden = node.id !== id; });
  document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node.dataset.view === id));
}

function requirementChanged() {
  const requirement = state.requirements.find(row => row.id === $('requirement').value);
  if (!requirement) return;
  const template = state.templates.find(row => row.id === requirement.templateId);
  const container = $('inspection-items'); container.replaceChildren();
  template.items.forEach((item, index) => {
    const fieldset = element('fieldset', undefined, 'inspection-row');
    const description = element('div');
    description.append(element('span', String(index + 1).padStart(2, '0'), 'item-number'),
      element('legend', item.label), element('p', item.method, 'method'));
    const controls = element('div'); const results = element('div', undefined, 'results');
    for (const [value, label] of [['normal', '正常'], ['abnormal', '異常'], ['not_applicable', '不適用']]) {
      const option = element('label'); const input = document.createElement('input');
      input.type = 'radio'; input.name = item.id; input.value = value; input.required = true;
      input.addEventListener('change', () => {
        controls.querySelector('textarea').required = value !== 'normal';
      });
      option.append(input, document.createTextNode(label)); results.append(option);
    }
    const noteLabel = element('label', '備註', 'item-note'); const note = element('textarea');
    note.rows = 2; note.maxLength = 1000; note.dataset.itemNote = item.id; noteLabel.append(note);
    controls.append(results, noteLabel); fieldset.append(description, controls); container.append(fieldset);
  });
}

function table(headers, rows) {
  if (!rows.length) return element('div', '目前沒有可查閱的資料。', 'empty');
  const node = element('table'); const head = element('thead'); const tr = element('tr');
  headers.forEach(label => tr.append(element('th', label))); head.append(tr); node.append(head);
  const body = element('tbody');
  rows.forEach(cells => { const row = element('tr'); cells.forEach(content => {
    const cell = element('td'); cell.append(content instanceof Node ? content : document.createTextNode(String(content)));
    row.append(cell);
  }); body.append(row); }); node.append(body); return node;
}
function status(value) { return element('span', stateNames[value] ?? value, 'status ' + value); }
function caseName(item) {
  if (item.kind === 'event') return item.category;
  const equipment = state.equipment.find(row => row.id === item.equipmentId);
  const record = state.records.find(row => row.inspection.equipment.id === item.equipmentId &&
    row.inspection.template.items.some(entry => entry.id === item.itemId));
  const template = record?.inspection.template ?? state.templates.find(row => row.items.some(entry => entry.id === item.itemId));
  return `${equipment?.name ?? item.equipmentId} · ${template?.items.find(row => row.id === item.itemId)?.label ?? item.itemId}`;
}

function render() {
  $('organization').textContent = state.organization;
  $('updated-at').textContent = '更新 ' + dateText(state.updatedAt);
  $('case-count').textContent = state.cases.filter(row => row.status !== 'closed').length;
  $('inspection-date').value = today(); $('completion-date').value = today();
  $('inspector-label').textContent = '填報角色：' + state.viewer.label;
  $('submit-inspection').disabled = !state.viewer.roles.includes('inspect');
  const current = $('requirement').value;
  $('requirement').replaceChildren(...state.requirements.map(row => {
    const option = element('option', state.equipment.find(item => item.id === row.equipmentId)?.name +
      ' / ' + (row.cycle === 'daily' ? '每日' : '每月')); option.value = row.id; return option;
  }));
  if (state.requirements.some(row => row.id === current)) $('requirement').value = current;
  if (!$('inspection-items').children.length) requirementChanged();
  $('event-site').replaceChildren(...state.sites.map(row => {
    const option = element('option', row.name); option.value = row.id; return option;
  }));
  $('cases-list').replaceChildren(table(['案件', '類型', '狀態', '更新版本', '操作'],
    state.cases.toReversed().map(item => [caseName(item), item.kind === 'event' ? '事件' : '設備',
      status(item.status), 'v' + item.version, button('查看／處理', 'eye', () => openCase(item.id))])));
  const totals = cycle => {
    const rows = state.progress.filter(row => row.cycle === cycle && row.required);
    return `${rows.filter(row => row.completed).length} / ${rows.length}`;
  };
  const metrics = [['今日檢查', totals('daily')], ['本月檢查', totals('monthly')],
    ['未結案件', String(state.cases.filter(row => row.status !== 'closed').length)],
    ['待確認', String(state.cases.filter(row => row.status === 'awaiting_confirmation').length)]];
  $('metrics').replaceChildren(...metrics.map(([name, value]) => {
    const metric = element('div', undefined, 'metric'); metric.append(element('div', name, 'name'),
      element('div', value, 'number'), element('small', '示範資料')); return metric;
  }));
  $('progress-table').replaceChildren(table(['設備', '週期', '期間', '狀態'], state.progress.map(row =>
    [row.equipmentName, row.cycle === 'daily' ? '每日' : '每月', row.period,
      element('span', !row.required ? '無需求' : row.completed ? '已填報' : '待填報',
        'status ' + (row.completed ? 'closed' : row.required ? 'pending' : ''))])));
  $('records-table').replaceChildren(table(['設備', '週期', '期間', '填報時間', '示範文件'], state.records.toReversed().map(row =>
    [row.inspection.equipment.name, row.inspection.requirement.cycle === 'daily' ? '每日' : '每月',
      row.inspection.period, dateText(row.receivedAt), button('下載示範 PDF', 'file-down', () => downloadPdf(row.id))])));
  const health = [['資料保存', state.health.storage === 'private_sheets_trial' ? '私人 Sheets 隔離試行' : '本機檔案隔離保存'],
    ['LINE 通知', '停用，只預覽名單'], ['排程', '停用，未安裝觸發器'],
    ['未完成操作', state.health.incompleteOperations === null ? '限管理者查看' : String(state.health.incompleteOperations)]];
  $('health').replaceChildren(...health.map(([name, value]) => { const node = element('div');
    node.append(element('strong', name), element('span', value)); return node; }));
  $('actor').hidden = !state.capabilities.switchActors;
  document.querySelector('label[for=actor]').textContent = state.capabilities.switchActors ? '示範角色' : 'Google 授權角色';
  $('google-actor').textContent = state.capabilities.switchActors ? '' : state.viewer.label;
  if (state.actors) $('actor').replaceChildren(...state.actors.map(row => { const option = element('option', row.label);
    option.value = row.id; option.selected = row.id === state.viewer.id; return option; }));
  $('environment-label').textContent = state.capabilities.switchActors ? '本機隔離示範' : 'Google 私人隔離試行';
  refreshIcons();
}

async function load() {
  try {
    state = await rpc({ action: 'bootstrap' });
    if (state.setupRequired) {
      document.querySelectorAll('.view').forEach(node => { node.hidden = true; }); $('setup').hidden = false;
      return;
    }
    $('setup').hidden = true; render();
  } catch (error) { fail(error); }
}

async function execute(command) {
  if (busy) return;
  busy = true; pending = command; $('retry-area').hidden = true;
  document.querySelectorAll('button[type=submit]').forEach(node => { node.disabled = true; });
  try {
    const result = await rpc({ action: 'execute', command: pending });
    pending = null; notice('已保存示範紀錄；LINE 未發送。'); await load();
    if (result.caseIds?.length && $('case-dialog').open) await openCase(result.caseIds[0]);
  } catch (error) {
    fail(error);
    if (['SYNC_PENDING', 'BUSY', 'NETWORK_ERROR'].includes(error.code ?? 'NETWORK_ERROR')) $('retry-area').hidden = false;
    else pending = null;
  } finally {
    busy = false; document.querySelectorAll('button[type=submit]').forEach(node => { node.disabled = false; });
    if (state?.viewer) $('submit-inspection').disabled = !state.viewer.roles.includes('inspect');
  }
}

async function openCase(id) {
  $('dialog-message').hidden = true;
  try {
    const details = await rpc({ action: 'case', id }); selectedCase = details.item;
    $('case-title').textContent = caseName(selectedCase);
    const meta = element('dl', undefined, 'case-meta');
    for (const [label, value] of [['案件', selectedCase.id], ['狀態', stateNames[selectedCase.status]],
      ['版本', 'v' + selectedCase.version], ['處理人', selectedCase.handlerId ?? '尚未接案'],
      ['處理說明', selectedCase.handling?.description ?? selectedCase.description ?? '—']]) {
      meta.append(element('dt', label), element('dd', value));
    }
    $('case-details').replaceChildren(meta);
    const history = element('ol', undefined, 'timeline');
    details.history.forEach(row => { const entry = element('li', actionNames[row.type] ?? row.type);
      entry.append(element('span', dateText(row.at) + ' · ' + row.actorId)); history.append(entry); });
    $('case-history').replaceChildren(element('h2', '處理歷程'), history);
    $('action-input').value = ''; $('completion-date').value = today(); $('case-actions').replaceChildren();
    const actions = [];
    if (state.viewer.roles.includes('handle') && ['pending', 'reported'].includes(selectedCase.status)) actions.push('claim');
    if (state.viewer.roles.includes('handle') && selectedCase.status === 'in_progress' &&
      selectedCase.handlerId === state.viewer.id) actions.push('report');
    if (state.viewer.roles.includes('confirm') && selectedCase.status === 'awaiting_confirmation') actions.push('confirm', 'return');
    if (state.viewer.roles.includes('confirm') && selectedCase.status === 'closed') actions.push('reopen');
    $('action-input-label').hidden = !actions.some(type => type !== 'claim');
    $('completion-label').hidden = !actions.includes('report');
    actions.forEach(type => { const node = button(actionNames[type], type === 'claim' ? 'wrench' : 'send', () => caseAction(type));
      if (type === 'confirm' || type === 'report') node.classList.add('primary'); $('case-actions').append(node); });
    $('notification-preview').replaceChildren();
    if (state.viewer.roles.includes('admin')) $('notification-preview').append(button('預覽指定通知名單', 'eye', preview));
    if (!$('case-dialog').open) $('case-dialog').showModal(); refreshIcons();
  } catch (error) { fail(error); }
}
function caseAction(type) {
  const command = { requestId: crypto.randomUUID(), type, caseId: selectedCase.id,
    expectedVersion: selectedCase.version, expectedStatus: selectedCase.status };
  const text = $('action-input').value.trim();
  if (type !== 'claim' && !text) { notice('請填寫處理說明、確認意見或原因。', true); return; }
  if (type === 'report') { command.description = text; command.completedDate = $('completion-date').value; }
  if (type === 'confirm') command.comment = text;
  if (['return', 'reopen'].includes(type)) command.reason = text;
  execute(command);
}
async function preview() {
  try {
    const data = await rpc({ action: 'preview', id: selectedCase.id });
    const list = element('ul'); data.eligible.forEach(row => list.append(element('li', row.personId)));
    $('notification-preview').replaceChildren(element('strong', `符合 ${data.eligible.length} 位示範角色，實際發送 0 則`), list,
      element('p', '正式 LINE 綁定與發送未啟用。')); refreshIcons();
  } catch (error) { fail(error); }
}
async function downloadPdf(id) {
  try {
    const data = await rpc({ action: 'pdf', id });
    const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = element('a'); link.href = url; link.download = data.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000); notice('已下載隔離示範 PDF，非正式檢查紀錄。');
  } catch (error) { fail(error); }
}

document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => {
  if (state?.viewer) showView(node.dataset.view);
}));
document.querySelectorAll('.refresh').forEach(node => node.addEventListener('click', load));
$('requirement').addEventListener('change', requirementChanged);
$('close-dialog').addEventListener('click', () => $('case-dialog').close());
$('case-action-form').addEventListener('submit', event => event.preventDefault());
$('retry').addEventListener('click', () => { if (pending) execute(pending); });
$('actor').addEventListener('change', async () => {
  if (pending || busy) { $('actor').value = state.viewer.id; notice('請先完成原操作，再切換示範角色。', true); return; }
  try { await rpc({ action: 'actor', id: $('actor').value }); $('case-dialog').close();
    $('inspection-items').replaceChildren(); await load(); } catch (error) { fail(error); }
});
$('inspection-form').addEventListener('submit', event => {
  event.preventDefault();
  const requirement = state.requirements.find(row => row.id === $('requirement').value);
  const template = state.templates.find(row => row.id === requirement.templateId);
  const answers = Object.fromEntries(template.items.map(item => [item.id, {
    result: [...$('inspection-form').querySelectorAll('input[type=radio]')]
      .find(node => node.name === item.id && node.checked)?.value,
    note: [...document.querySelectorAll('[data-item-note]')].find(node => node.dataset.itemNote === item.id)?.value.trim() ?? ''
  }]));
  const date = today();
  execute({ requestId: crypto.randomUUID(), type: 'inspect', requirementId: requirement.id,
    templateVersion: template.version, period: requirement.cycle === 'daily' ? date : date.slice(0, 7),
    actualAt: new Date().toISOString(), answers, signatureRef: 'FAKE-SIGNATURE' });
});
$('event-form').addEventListener('submit', event => {
  event.preventDefault(); execute({ requestId: crypto.randomUUID(), type: 'event', siteId: $('event-site').value,
    category: $('event-category').value, urgency: $('event-urgency').value,
    description: $('event-description').value.trim(), actualAt: new Date().toISOString() });
});
$('initialize').addEventListener('click', () => {
  if (!globalThis.google?.script?.run) return;
  $('initialize').disabled = true;
  google.script.run.withSuccessHandler(async result => {
    $('initialize').disabled = false;
    if (result.ok) { await load(); showView('inspection'); } else fail(result.error);
  }).withFailureHandler(() => { $('initialize').disabled = false; fail({ code: 'NETWORK_ERROR' }); }).kitSetupSandbox();
});
refreshIcons();
if (globalThis.google?.script?.run) load();
else fetch('/api/session', { credentials: 'same-origin' }).then(response => response.json())
  .then(data => { csrf = data.csrf; return load(); }).catch(fail);
