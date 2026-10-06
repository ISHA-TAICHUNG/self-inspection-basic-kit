import { KitError, requireValue, stableId, digest, canonical, nonempty } from '../domain/common.mjs';
import { validateConfig } from '../domain/config.mjs';
import { personAt, authorize, canView } from '../domain/authorization.mjs';
import { validateInspection } from '../domain/inspection.mjs';
import { transition } from '../domain/workflow.mjs';
import { previewRecipients } from '../domain/notifications.mjs';

const ACTIONS = ['claim', 'takeover', 'report', 'confirm', 'return', 'reopen'];
const COMMAND_FIELDS = {
  inspect: ['requirementId', 'templateVersion', 'period', 'actualAt', 'answers', 'signatureRef'],
  event: ['siteId', 'category', 'urgency', 'description', 'actualAt'],
  claim: ['caseId', 'expectedVersion', 'expectedStatus'],
  takeover: ['caseId', 'expectedVersion', 'expectedStatus', 'reason'],
  report: ['caseId', 'expectedVersion', 'expectedStatus', 'description', 'completedDate'],
  confirm: ['caseId', 'expectedVersion', 'expectedStatus', 'comment'],
  return: ['caseId', 'expectedVersion', 'expectedStatus', 'reason'],
  reopen: ['caseId', 'expectedVersion', 'expectedStatus', 'reason']
};

/** 單一業務寫入入口。現階段只配假驗證、記憶體儲存與草稿歸檔。 */
export class KitService {
  constructor({ config, repository, identity, clock = () => new Date().toISOString() }) {
    this.config = validateConfig(config);
    this.repository = repository;
    this.identity = identity;
    this.clock = clock;
  }

  actor(context) {
    const claims = this.identity.authenticate(context);
    return personAt(this.config, claims.subject, this.clock());
  }

  execute(context, command) {
    const actor = this.actor(context);
    requireValue(COMMAND_FIELDS[command?.type], 'ACTION_NOT_SUPPORTED');
    requireValue(typeof command.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(command.requestId), 'REQUEST_ID_REQUIRED');
    const allowed = new Set(['type', 'requestId', ...COMMAND_FIELDS[command.type]]);
    requireValue(Object.keys(command).every(key => allowed.has(key)), 'UNEXPECTED_COMMAND_FIELD');
    requireValue(canonical(command).length <= 100000, 'COMMAND_TOO_LARGE');
    const hash = digest({ digestVersion: 1, actorId: actor.id, command });
    return this.repository.withLock(() => {
      // 權限在受理鎖內再次查；驗證與保存不能分成兩個臨界區。
      const currentActor = this.actor(context);
      const original = this.repository.get('operations', command.requestId);
      if (original) {
        requireValue(original.actorId === currentActor.id && original.digest === hash, 'REQUEST_CONTENT_CONFLICT');
        this.assertOperationVisible(currentActor, original);
        requireValue(!original.frozen, 'RECOVERY_REQUIRED');
        if (original.status === 'voided') return this.result(original);
        return this.resume(original);
      }
      const plan = this.plan(currentActor, command);
      const reserved = this.repository.list('operations').filter(row =>
        !['complete', 'voided'].includes(row.status));
      requireValue(!reserved.some(row => row.resourceKeys.some(key => plan.resourceKeys.includes(key))), 'SYNC_PENDING');
      const operation = {
        requestId: command.requestId, actionId: stableId('ACT', command.requestId), actorId: currentActor.id,
        digest: hash, digestVersion: 1, command: structuredClone(command), status: 'accepted',
        configVersion: this.config.configVersion, siteIds: plan.siteIds,
        resourceKeys: plan.resourceKeys, steps: plan.steps, resultIds: plan.resultIds,
        acceptedAt: this.clock(), frozen: false
      };
      this.repository.put('operations', command.requestId, operation);
      return this.resume(operation);
    });
  }

  assertOperationVisible(actor, operation) {
    requireValue(operation.siteIds.every(siteId => actor.sites.includes(siteId)), 'FORBIDDEN');
  }

  result(operation) {
    return { requestId: operation.requestId, actionId: operation.actionId,
      status: operation.status, ...structuredClone(operation.resultIds) };
  }

  plan(actor, command) {
    const now = this.clock();
    const actionId = stableId('ACT', command.requestId);
    const steps = [];
    const caseIds = [];
    const resourceKeys = [];
    const siteIds = [];
    const addHistory = (item, type, details) => {
      const id = stableId('HIS', [actionId, item.id]);
      steps.push({ table: 'history', id, value: {
        id, caseId: item.id, actionId, requestId: command.requestId,
        actorId: actor.id, type, at: now, version: item.version, details
      } });
    };
    const addNotification = (item, event) => {
      if (!event) return;
      const recipients = previewRecipients(this.config, item, event, now);
      const id = stableId('NTF', [actionId, item.id, event]);
      steps.push({ table: 'notifications', id, value: {
        id, actionId, caseId: item.id, event, configVersion: this.config.configVersion,
        originalRecipients: recipients.eligible, excluded: recipients.excluded,
        status: recipients.eligible.length ? 'preview_only' : 'not_notified', reason: recipients.reason,
        networkAttempts: 0, createdAt: now
      } });
    };
    if (command.type === 'inspect') {
      const inspection = validateInspection(this.config, actor, command, now);
      siteIds.push(inspection.siteId);
      resourceKeys.push('requirement:' + inspection.requirement.id + ':' + inspection.period);
      const recordId = stableId('CHK', actionId);
      steps.push({ table: 'records', id: recordId, value: {
        id: recordId, actionId, requestId: command.requestId, reporterId: actor.id,
        receivedAt: now, siteId: inspection.siteId, inspection
      } });
      for (const templateItem of inspection.template.items) {
        const answer = inspection.answers[templateItem.id];
        const key = 'issue:' + inspection.equipment.id + ':' + templateItem.id;
        resourceKeys.push(key);
        const same = this.repository.list('cases').filter(row => row.kind === 'equipment' &&
          row.equipmentId === inspection.equipment.id && row.itemId === templateItem.id);
        const open = same.find(row => row.status !== 'closed');
        requireValue(!open || answer.result === 'abnormal', 'OPEN_ISSUE_CANNOT_BE_NORMAL');
        if (answer.result !== 'abnormal') continue;
        const item = open ? structuredClone(open) : {
          id: stableId('ISS', [actionId, templateItem.id]), kind: 'equipment', status: 'pending',
          version: 0, equipmentId: inspection.equipment.id, itemId: templateItem.id,
          siteId: inspection.siteId, reporterId: actor.id, discovererIds: [], urgency: 'general',
          predecessorId: same.toReversed().find(row => row.status === 'closed')?.id ?? null,
          openedAt: now, handlerId: null
        };
        item.discovererIds = [...new Set([...item.discovererIds, actor.id])];
        item.version += 1;
        steps.push({ table: 'cases', id: item.id, before: open ?? null, value: item });
        addHistory(item, open ? 'rediscovered' : 'opened', { recordId, itemId: templateItem.id, note: answer.note });
        addNotification(item, open ? null : 'opened');
        caseIds.push(item.id);
      }
      steps.push({ table: 'archives', id: recordId, value: {
        id: recordId, recordId, format: 'json', status: 'draft_only', privateFileAvailable: false
      } });
      return { steps, resourceKeys, siteIds, resultIds: { recordId, caseIds } };
    }
    if (command.type === 'event') {
      requireValue(this.config.sites.some(row => row.id === command.siteId), 'SITE_NOT_FOUND');
      requireValue(actor.sites.includes(command.siteId), 'FORBIDDEN');
      requireValue(nonempty(command.category) && nonempty(command.description) &&
        ['general', 'urgent'].includes(command.urgency), 'EVENT_FIELDS_REQUIRED');
      requireValue(typeof command.actualAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(command.actualAt) &&
        Number.isFinite(Date.parse(command.actualAt)) && Date.parse(command.actualAt) <= Date.parse(now), 'ACTUAL_TIME_INVALID');
      const item = {
        id: stableId('EVT', actionId), kind: 'event', status: 'reported', version: 1,
        siteId: command.siteId, reporterId: actor.id, urgency: command.urgency,
        category: command.category, description: command.description, actualAt: command.actualAt,
        receivedAt: now, handlerId: null
      };
      steps.push({ table: 'cases', id: item.id, before: null, value: item });
      addHistory(item, 'reported', { description: command.description });
      addNotification(item, 'opened');
      return { steps, resourceKeys: ['case:' + item.id], siteIds: [item.siteId], resultIds: { caseIds: [item.id] } };
    }
    requireValue(ACTIONS.includes(command.type), 'ACTION_NOT_SUPPORTED');
    const item = this.repository.get('cases', command.caseId);
    requireValue(item, 'CASE_NOT_FOUND');
    const { next, notificationEvent } = transition(this.config, actor, item, command, now);
    steps.push({ table: 'cases', id: item.id, before: item, value: next });
    addHistory(next, command.type, structuredClone(command));
    addNotification(next, notificationEvent);
    const resources = ['case:' + item.id];
    if (item.kind === 'equipment') resources.push('issue:' + item.equipmentId + ':' + item.itemId);
    return { steps, resourceKeys: resources, siteIds: [item.siteId], resultIds: { caseIds: [item.id] } };
  }

  resume(operation) {
    if (operation.status === 'complete') return this.result(operation);
    operation.attempts = (operation.attempts ?? 0) + 1;
    try {
      for (const step of operation.steps) {
        if (step.table === 'cases') {
          const actual = this.repository.get('cases', step.id) ?? null;
          if (canonical(actual) !== canonical(step.value)) {
            requireValue(canonical(actual) === canonical(step.before), 'ROW_CONTENT_CONFLICT');
            this.repository.put(step.table, step.id, step.value);
          }
        } else this.repository.ensure(step.table, step.id, step.value);
      }
      // 即使舊步驟標記遺失，也逐列讀回核對，而不是只相信標記。
      for (const step of operation.steps) {
        requireValue(canonical(this.repository.get(step.table, step.id)) === canonical(step.value), 'READBACK_MISMATCH');
      }
      operation.status = 'complete';
      this.repository.put('operations', operation.requestId, operation);
      return this.result(operation);
    } catch (error) {
      operation.status = 'needs_recovery';
      operation.failureCode = error instanceof KitError ? error.code : 'INTERRUPTED';
      operation.frozen = operation.failureCode === 'ROW_CONTENT_CONFLICT' || operation.attempts >= 3;
      this.repository.put('operations', operation.requestId, operation);
      throw new KitError(operation.frozen ? 'RECOVERY_REQUIRED' : 'SYNC_PENDING');
    }
  }

  dashboard(context) {
    const actor = this.actor(context);
    const pendingResources = new Set(this.repository.list('operations').filter(row =>
      !['complete', 'voided'].includes(row.status)).flatMap(row => row.resourceKeys));
    const cases = this.repository.list('cases').filter(item => canView(actor, item)).map(item => ({
      ...item, syncing: pendingResources.has('case:' + item.id) ||
        pendingResources.has('issue:' + item.equipmentId + ':' + item.itemId)
    })).map(item => ({ ...item, projectedStatus: item.status, status: item.syncing ? 'syncing' : item.status }));
    const records = this.repository.list('records').filter(row => actor.sites.includes(row.siteId) &&
      (actor.id === row.reporterId || actor.roles.some(role => ['confirm', 'view', 'admin'].includes(role)) ||
        cases.some(item => item.kind === 'equipment' && item.equipmentId === row.inspection.equipment.id)))
      .filter(row => this.repository.get('operations', row.requestId)?.status === 'complete');
    return { mode: 'sandbox', updatedAt: this.clock(), cases, records,
      uniqueCompletedRequirements: new Set(records.map(row =>
        row.inspection.requirement.id + ':' + row.inspection.period)).size,
      notificationTransport: 'disabled', archiveFormat: 'draft_json_only' };
  }

  caseDetails(context, id) {
    const actor = this.actor(context);
    const item = this.repository.get('cases', id);
    requireValue(item && canView(actor, item), 'FORBIDDEN');
    const visible = this.dashboard(context).cases.find(row => row.id === id);
    return { item: visible, history: this.repository.list('history').filter(row => row.caseId === id) };
  }

  notificationPreview(context, id) {
    const actor = this.actor(context);
    const item = this.repository.get('cases', id);
    requireValue(item, 'CASE_NOT_FOUND');
    authorize(actor, 'admin', item.siteId);
    return previewRecipients(this.config, item, 'opened', this.clock());
  }

  recoveryReport(context, requestId) {
    const actor = this.actor(context);
    const operation = this.repository.get('operations', requestId);
    requireValue(operation && operation.status !== 'complete', 'NO_RECOVERY_REQUIRED');
    for (const siteId of operation.siteIds) authorize(actor, 'admin', siteId);
    const rows = operation.steps.map(step => {
      const actual = this.repository.get(step.table, step.id);
      return { table: step.table, id: step.id, exists: Boolean(actual),
        matches: canonical(actual) === canonical(step.value) };
    });
    return { requestId, status: operation.status, rows,
      canVoid: rows.every(row => !row.exists), manualResolutionRequired: operation.frozen,
      reportDigest: digest({ operation, rows }) };
  }

  voidUnusedIntent(context, requestId, { maintenanceId, reportDigest, reason }) {
    return this.repository.withLock(() => {
      requireValue(typeof maintenanceId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(maintenanceId) &&
        nonempty(reason), 'MAINTENANCE_INPUT_REQUIRED');
      const actor = this.actor(context);
      const previous = this.repository.get('maintenance', maintenanceId);
      const commandDigest = digest({ actorId: actor.id, requestId, reportDigest, reason });
      if (previous) {
        requireValue(previous.digest === commandDigest, 'REQUEST_CONTENT_CONFLICT');
        const target = this.repository.get('operations', requestId);
        for (const siteId of target.siteIds) authorize(actor, 'admin', siteId);
        if (previous.status === 'complete') return { status: 'voided', requestId };
        if (target.status === 'voided') {
          requireValue(target.steps.every(step => !this.repository.get(step.table, step.id)), 'SIDE_EFFECTS_PREVENT_VOID');
          previous.status = 'complete';
          this.repository.put('maintenance', maintenanceId, previous);
          return { status: 'voided', requestId };
        }
      }
      const report = this.recoveryReport(context, requestId);
      requireValue(report.reportDigest === reportDigest, 'REPORT_STALE');
      requireValue(report.canVoid, 'SIDE_EFFECTS_PREVENT_VOID');
      const audit = previous ?? { id: maintenanceId, actorId: actor.id, requestId, digest: commandDigest,
        reason, reportDigest, status: 'accepted', at: this.clock() };
      this.repository.ensure('maintenance', maintenanceId, previous ?? audit);
      const operation = this.repository.get('operations', requestId);
      operation.status = 'voided';
      operation.frozen = false;
      this.repository.put('operations', requestId, operation);
      audit.status = 'complete';
      this.repository.put('maintenance', maintenanceId, audit);
      return { status: 'voided', requestId };
    });
  }
}
