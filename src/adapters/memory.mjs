import { canonical, requireValue } from '../domain/common.mjs';

const TABLES = ['operations', 'records', 'cases', 'history', 'notifications', 'archives', 'maintenance'];

/** 隔離測試儲存層，不是 Sheets 交易或持久化證據。 */
export class MemoryRepository {
  constructor(snapshot) {
    this.tables = Object.fromEntries(TABLES.map(table => [table, new Map(snapshot?.[table] ?? [])]));
    this.busy = false;
    this.afterWrite = null;
  }

  withLock(fn) {
    requireValue(!this.busy, 'BUSY');
    this.busy = true;
    try { return fn(); } finally { this.busy = false; }
  }

  get(table, id) { return structuredClone(this.tables[table].get(id)); }
  list(table) { return [...this.tables[table].values()].map(row => structuredClone(row)); }

  put(table, id, value) {
    this.tables[table].set(id, structuredClone(value));
    this.afterWrite?.(table, id);
  }

  ensure(table, id, value) {
    const previous = this.get(table, id);
    if (previous) requireValue(canonical(previous) === canonical(value), 'ROW_CONTENT_CONFLICT');
    else this.put(table, id, value);
  }

  snapshot() {
    return structuredClone(Object.fromEntries(TABLES.map(table => [table, [...this.tables[table].entries()]])));
  }
}
