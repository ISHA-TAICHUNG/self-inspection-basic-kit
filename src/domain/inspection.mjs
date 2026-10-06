import { requireValue, nonempty, localDate, validDate } from './common.mjs';
import { authorize } from './authorization.mjs';

/** 伺服器政策原型：範本與日期以核定設定為準，答案不預填正常。 */
export function validateInspection(config, person, input, now) {
  const requirement = config.requirements.find(row => row.id === input.requirementId && row.active);
  requireValue(requirement, 'REQUIREMENT_NOT_FOUND');
  const equipment = config.equipment.find(row => row.id === requirement.equipmentId && row.active);
  requireValue(equipment, 'EQUIPMENT_INACTIVE');
  authorize(person, 'inspect', equipment.siteId);
  const template = config.templates.find(row => row.id === requirement.templateId);
  requireValue(input.templateVersion === template.version, 'TEMPLATE_VERSION_CONFLICT');
  requireValue(typeof input.actualAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(input.actualAt) &&
    Number.isFinite(Date.parse(input.actualAt)) && Date.parse(input.actualAt) <= Date.parse(now), 'ACTUAL_TIME_INVALID');
  const actualDate = localDate(input.actualAt, config.timeZone);
  const currentDate = localDate(now, config.timeZone);
  const period = requirement.cycle === 'daily' ? actualDate : actualDate.slice(0, 7);
  requireValue(input.period === period, 'PERIOD_MISMATCH');
  requireValue(actualDate === currentDate, 'BACKFILL_NOT_IMPLEMENTED');
  if (requirement.cycle === 'daily') {
    const weekday = new Date(actualDate + 'T00:00:00Z').getUTCDay();
    requireValue(config.calendar.workingWeekdays.includes(weekday) &&
      !config.calendar.closedDates.includes(actualDate), 'NO_REQUIREMENT_TODAY');
  }
  requireValue(input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) &&
    Object.keys(input.answers).length === template.items.length, 'ANSWERS_INCOMPLETE');
  for (const item of template.items) {
    const answer = input.answers[item.id];
    requireValue(answer && ['normal', 'abnormal', 'not_applicable'].includes(answer.result), 'ANSWER_REQUIRED');
    requireValue(Object.keys(answer).every(key => ['result', 'note', 'photos'].includes(key)), 'UNEXPECTED_ANSWER_FIELD');
    if (answer.result !== 'normal') requireValue(nonempty(answer.note), 'NOTE_REQUIRED');
    requireValue(item.photoPolicy === 'none', 'PHOTO_ADAPTER_NOT_IMPLEMENTED');
    requireValue(answer.photos === undefined || (Array.isArray(answer.photos) && answer.photos.length === 0), 'PHOTO_ADAPTER_NOT_IMPLEMENTED');
  }
  // 僅允許測試簽名引用；正式檔案摘要必須由尚未實作的私有檔案層核對。
  if (template.signatureRequired) requireValue(input.signatureRef === 'FAKE-SIGNATURE', 'SIGNATURE_REQUIRED');
  return {
    equipment: structuredClone(equipment), requirement: structuredClone(requirement),
    template: structuredClone(template), period, actualAt: input.actualAt,
    answers: structuredClone(input.answers), siteId: equipment.siteId,
    inspectorId: person.id, signatureRef: input.signatureRef ?? null,
    configVersion: config.configVersion, timeZone: config.timeZone
  };
}

export function validateCompletionDate(value, now, timeZone) {
  requireValue(validDate(value) && value <= localDate(now, timeZone), 'COMPLETION_DATE_INVALID');
}
