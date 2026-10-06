import { requireValue } from './common.mjs';

export function isActive(person, now) {
  return Boolean(person?.active && (!person.expiresAt || Date.parse(person.expiresAt) > Date.parse(now)));
}

export function personAt(config, personId, now) {
  const person = config.people.find(row => row.id === personId);
  requireValue(isActive(person, now), 'PERSON_INACTIVE');
  return person;
}

export function authorize(person, role, siteId) {
  requireValue(person.roles.includes(role) && person.sites.includes(siteId), 'FORBIDDEN');
}

export function canView(person, item) {
  return person.sites.includes(item.siteId) && (
    person.roles.some(role => ['handle', 'confirm', 'view', 'admin'].includes(role)) ||
    item.reporterId === person.id || item.discovererIds?.includes(person.id)
  );
}

export function canHandle(person, item, now) {
  return isActive(person, now) && person.roles.includes('handle') && person.sites.includes(item.siteId);
}
