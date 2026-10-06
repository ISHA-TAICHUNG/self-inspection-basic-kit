import { requireValue, nonempty, validDate } from './common.mjs';

export const ROLES = ['inspect', 'handle', 'confirm', 'view', 'admin'];
const EVENTS = ['opened', 'awaiting_confirmation', 'returned', 'reopened'];

/** 驗證核定前的設定草稿，不把空範圍當成全部。 */
export function validateConfig(config) {
  requireValue(config?.schemaVersion === 1, 'SCHEMA_UNSUPPORTED');
  const allowed = new Set(['schemaVersion', 'configVersion', 'organization', 'timeZone', 'mode',
    'allowSelfConfirmation', 'sites', 'equipment', 'templates', 'requirements', 'calendar',
    'people', 'notificationRules']);
  requireValue(Object.keys(config).every(key => allowed.has(key)), 'UNEXPECTED_CONFIG_FIELD');
  const rejectSecrets = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      requireValue(!/(token|password|secret|private.?key|api.?key)/i.test(key), 'SECRET_IN_CONFIG');
      rejectSecrets(child);
    }
  };
  rejectSecrets(config);
  requireValue(config.mode === 'sandbox', 'PRODUCTION_NOT_IMPLEMENTED');
  requireValue(nonempty(config.organization) && nonempty(config.configVersion), 'CONFIG_REQUIRED');
  requireValue(typeof config.allowSelfConfirmation === 'boolean', 'CONFIG_REQUIRED');
  try { new Intl.DateTimeFormat('en', { timeZone: config.timeZone }).format(); }
  catch { requireValue(false, 'TIMEZONE_INVALID'); }
  requireValue(nonempty(config.timeZone), 'TIMEZONE_INVALID');
  for (const table of ['sites', 'equipment', 'templates', 'requirements', 'people', 'notificationRules']) {
    requireValue(Array.isArray(config[table]) && config[table].length > 0, 'CONFIG_TABLE_REQUIRED');
    const ids = config[table].map(row => row.id);
    requireValue(ids.every(nonempty) && new Set(ids).size === ids.length, 'DUPLICATE_ID');
  }
  const sites = new Set(config.sites.map(row => row.id));
  const equipment = new Map(config.equipment.map(row => [row.id, row]));
  const templates = new Map(config.templates.map(row => [row.id, row]));
  for (const row of config.equipment) {
    requireValue(sites.has(row.siteId) && nonempty(row.name) && typeof row.active === 'boolean', 'EQUIPMENT_INVALID');
  }
  for (const template of config.templates) {
    requireValue(Number.isInteger(template.version) && template.version > 0 &&
      typeof template.signatureRequired === 'boolean' &&
      Array.isArray(template.items) && template.items.length > 0, 'TEMPLATE_INVALID');
    requireValue(new Set(template.items.map(item => item.id)).size === template.items.length, 'DUPLICATE_ITEM');
    for (const item of template.items) {
      requireValue(nonempty(item.id) && nonempty(item.label) && nonempty(item.method) &&
        ['none', 'abnormal', 'always'].includes(item.photoPolicy), 'ITEM_INVALID');
    }
  }
  const requirementKeys = new Set();
  for (const row of config.requirements) {
    requireValue(equipment.has(row.equipmentId) && templates.has(row.templateId) &&
      ['daily', 'monthly'].includes(row.cycle) && typeof row.active === 'boolean' &&
      row.schedule === (row.cycle === 'daily' ? 'workdays' : 'calendar-month'), 'REQUIREMENT_INVALID');
    const key = row.equipmentId + ':' + row.cycle;
    requireValue(!requirementKeys.has(key), 'DUPLICATE_REQUIREMENT');
    requirementKeys.add(key);
  }
  for (const row of config.equipment.filter(item => item.active)) {
    requireValue(config.requirements.some(item => item.active && item.equipmentId === row.id), 'REQUIREMENT_MISSING');
  }
  requireValue(Array.isArray(config.calendar?.workingWeekdays) &&
    config.calendar.workingWeekdays.length > 0 &&
    config.calendar.workingWeekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6) &&
    Array.isArray(config.calendar.closedDates) && config.calendar.closedDates.every(validDate), 'CALENDAR_INVALID');
  for (const person of config.people) {
    requireValue(nonempty(person.label) && typeof person.active === 'boolean' &&
      Array.isArray(person.roles) && person.roles.length > 0 && person.roles.every(role => ROLES.includes(role)) &&
      Array.isArray(person.sites) && person.sites.length > 0 && person.sites.every(site => sites.has(site)), 'PERSON_INVALID');
    requireValue(person.lineBinding === null || /^FAKE-BINDING-[A-Z0-9-]+$/.test(person.lineBinding), 'SANDBOX_BINDING_ONLY');
    requireValue(!person.expiresAt || Number.isFinite(Date.parse(person.expiresAt)), 'EXPIRY_INVALID');
  }
  for (const rule of config.notificationRules) {
    const scope = rule.scope;
    requireValue(typeof rule.active === 'boolean' && EVENTS.includes(rule.event) &&
      ['all', 'urgent'].includes(rule.urgency) && Array.isArray(rule.roles) && rule.roles.length > 0 &&
      rule.roles.every(role => ['handle', 'confirm', 'view', 'admin'].includes(role)), 'RULE_INVALID');
    requireValue(scope && (scope.all === true ||
      (Array.isArray(scope.siteIds) && scope.siteIds.length > 0 && scope.siteIds.every(id => sites.has(id))) ||
      (Array.isArray(scope.equipmentIds) && scope.equipmentIds.length > 0 && scope.equipmentIds.every(id => equipment.has(id)))), 'RULE_SCOPE_REQUIRED');
    requireValue(Object.keys(scope).every(key => ['all', 'siteIds', 'equipmentIds'].includes(key)), 'RULE_SCOPE_INVALID');
  }
  for (const siteId of new Set(config.equipment.filter(row => row.active).map(row => row.siteId))) {
    for (const role of ['handle', 'confirm']) {
      requireValue(config.people.some(person => person.active && person.roles.includes(role) &&
        person.sites.includes(siteId)), 'ROLE_COVERAGE_MISSING');
    }
  }
  return structuredClone(config);
}
