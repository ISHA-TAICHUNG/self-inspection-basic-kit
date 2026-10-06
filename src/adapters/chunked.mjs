import { canonical, digest, requireValue } from '../domain/common.mjs';

export const STORE_HEADER = ['table', 'id', 'revision', 'part', 'parts', 'checksum', 'body'];
const TABLES = new Set(['operations', 'records', 'cases', 'history', 'notifications', 'archives',
  'maintenance', 'files']);
const IMMUTABLE = new Set(['records', 'history', 'notifications', 'archives', 'files']);

export function chunks(text, limit = 18000) {
  const result = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    const char = text.charCodeAt(end - 1);
    if (end < text.length && char >= 0xD800 && char <= 0xDBFF) end -= 1;
    result.push(text.slice(start, end)); start = end;
  }
  return result;
}

/** 一個鎖域、追加分段後封存。未封存版本不被當成已保存資料。 */
export class ChunkedRepository {
  constructor({ readRows, appendRows, withLock, flush = () => {} }) {
    this.readRows = readRows; this.appendRows = appendRows;
    this.lock = withLock; this.flush = flush; this.held = false; this.rows = null;
  }

  withLock(fn) {
    requireValue(!this.held, 'BUSY');
    return this.lock(() => {
      this.held = true; this.rows = this.readRows();
      try { return fn(); } finally { this.held = false; this.rows = null; }
    });
  }

  rowsFor(table, id) {
    requireValue(TABLES.has(table), 'TABLE_NOT_SUPPORTED');
    const rows = this.rows ?? this.readRows();
    requireValue(rows.length <= 10000, 'SANDBOX_SCALE_LIMIT');
    return rows.filter(row => row[0] === table && (id === undefined || row[1] === id));
  }

  valueFor(rows, seal) {
    const [, , revision, , count, checksum] = seal;
    requireValue(Number.isInteger(count) && count > 0 && count <= 128, 'STORE_CORRUPT');
    const parts = rows.filter(row => row[2] === revision && row[3] >= 0);
    requireValue(parts.length === count, 'STORE_CORRUPT');
    parts.sort((a, b) => a[3] - b[3]);
    requireValue(parts.every((row, index) => row[3] === index && row[4] === count &&
      typeof row[6] === 'string' && row[6].startsWith('J:') &&
      'h:' + digest(row[6]) === row[5]), 'STORE_CORRUPT');
    const text = parts.map(row => row[6].slice(2)).join('');
    requireValue('h:' + digest(text) === checksum, 'STORE_CORRUPT');
    const value = JSON.parse(text);
    requireValue('r:' + digest({ table: seal[0], id: seal[1], value }) === revision, 'STORE_CORRUPT');
    return value;
  }

  get(table, id) {
    const rows = this.rowsFor(table, id);
    const seal = rows.filter(row => row[3] === -1).at(-1);
    return seal ? this.valueFor(rows, seal) : undefined;
  }

  list(table) {
    const ids = [...new Set(this.rowsFor(table).map(row => row[1]))];
    return ids.map(id => this.get(table, id)).filter(value => value !== undefined);
  }

  put(table, id, value) {
    requireValue(this.held, 'STORE_LOCK_REQUIRED');
    const previous = this.get(table, id);
    if (previous !== undefined && canonical(previous) === canonical(value)) return;
    requireValue(previous === undefined || !IMMUTABLE.has(table), 'ROW_CONTENT_CONFLICT');
    const text = canonical(value);
    requireValue(typeof text === 'string' && text.length <= 2000000, 'SNAPSHOT_TOO_LARGE');
    const revision = 'r:' + digest({ table, id, value });
    const segments = chunks(text);
    const expected = segments.map((part, index) => [table, id, revision, index,
      segments.length, 'h:' + digest('J:' + part), 'J:' + part]);
    const actual = this.rowsFor(table, id).filter(row => row[2] === revision && row[3] >= 0);
    requireValue(new Set(actual.map(row => row[3])).size === actual.length &&
      actual.every(row => canonical(row) === canonical(expected[row[3]])), 'STORE_CORRUPT');
    const missing = expected.filter(row => !actual.some(item => item[3] === row[3]));
    if (missing.length) this.append(missing);
    this.flush();
    const readback = this.readRows().filter(row => row[0] === table && row[1] === id &&
      row[2] === revision && row[3] >= 0);
    requireValue(canonical(readback.toSorted((a, b) => a[3] - b[3])) === canonical(expected), 'READBACK_MISMATCH');
    this.append([[table, id, revision, -1, segments.length, 'h:' + digest(text), 'sealed']]);
    this.flush(); this.rows = this.readRows();
    requireValue(canonical(this.get(table, id)) === canonical(value), 'READBACK_MISMATCH');
  }

  append(rows) {
    this.appendRows(rows); this.rows = this.readRows();
  }

  ensure(table, id, value) {
    const previous = this.get(table, id);
    if (previous !== undefined) requireValue(canonical(previous) === canonical(value), 'ROW_CONTENT_CONFLICT');
    else this.put(table, id, value);
  }
}
