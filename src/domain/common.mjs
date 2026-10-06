import { createHash } from 'node:crypto';

export class KitError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function requireValue(condition, code, message) {
  if (!condition) throw new KitError(code, message);
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function stableId(prefix, value) {
  return prefix + '-' + digest(value).slice(0, 24);
}

export function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function localDate(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
