import { localDate } from '../domain/common.mjs';

/** 只描述目前示範設定的當期需求，不重算歷史分母。 */
export function inspectionProgress(config, dashboard, actor, now) {
  const today = localDate(now, config.timeZone);
  const workday = config.calendar.workingWeekdays.includes(new Date(today + 'T00:00:00Z').getUTCDay()) &&
    !config.calendar.closedDates.includes(today);
  return config.requirements.filter(row => row.active).flatMap(requirement => {
    const equipment = config.equipment.find(row => row.id === requirement.equipmentId);
    if (!equipment?.active || !actor.sites.includes(equipment.siteId)) return [];
    const period = requirement.cycle === 'daily' ? today : today.slice(0, 7);
    const required = requirement.cycle === 'monthly' || workday;
    const records = dashboard.records.filter(row => row.inspection.requirement.id === requirement.id &&
      row.inspection.period === period);
    return [{ id: requirement.id, equipmentId: equipment.id, equipmentName: equipment.name,
      cycle: requirement.cycle, period, required, completed: required && records.length > 0,
      recordId: records.at(-1)?.id ?? null }];
  });
}

export function webState(service, context, capabilities) {
  const actor = service.actor(context);
  const dashboard = service.dashboard(context);
  const progress = inspectionProgress(service.config, dashboard, actor, service.clock());
  const config = service.config;
  const requirements = config.requirements.filter(row => progress.some(item => item.id === row.id));
  const templateIds = new Set(requirements.map(row => row.templateId));
  return { version: '0.2.1', viewer: { id: actor.id, label: actor.label, roles: actor.roles },
    organization: config.organization, timeZone: config.timeZone, capabilities,
    sites: config.sites.filter(row => actor.sites.includes(row.id)),
    equipment: config.equipment.filter(row => actor.sites.includes(row.siteId)),
    requirements, templates: config.templates.filter(row => templateIds.has(row.id)), progress, ...dashboard,
    health: { line: 'disabled', scheduler: 'disabled', storage: capabilities.storage,
      incompleteOperations: actor.roles.includes('admin') ? service.repository.list('operations')
        .filter(row => !['complete', 'voided'].includes(row.status) &&
          row.siteIds.every(siteId => actor.sites.includes(siteId))).length : null } };
}
