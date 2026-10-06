import { openSync, closeSync, readFileSync, writeFileSync, renameSync, fsyncSync, fstatSync,
  mkdirSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { canonical, digest, requireValue } from '../domain/common.mjs';
import { MemoryRepository } from './memory.mjs';

/** 僅本機隔離版：單一 process、原子換檔及摘要核對，不是 Sheets 適用規模證明。 */
export class FileSandboxRepository extends MemoryRepository {
  constructor(directory, config) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    requireValue(!lstatSync(directory).isSymbolicLink(), 'STORE_PATH_INVALID');
    const file = join(resolve(directory), 'state.json');
    let snapshot;
    if (existsSync(file)) {
      requireValue(!lstatSync(file).isSymbolicLink(), 'STORE_PATH_INVALID');
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      requireValue(saved.schemaVersion === 1 && saved.configDigest === digest(config), 'STORE_SCHEMA_OR_CONFIG_CHANGED');
      requireValue(saved.checksum === digest(saved.snapshot), 'STORE_CORRUPT');
      snapshot = saved.snapshot;
    }
    super(snapshot);
    this.file = file; this.configDigest = digest(config); this.failed = false;
    this.lease = join(resolve(directory), 'writer.lock');
    try { this.leaseFd = openSync(this.lease, 'wx', 0o600); }
    catch { requireValue(false, 'WRITER_ALREADY_RUNNING'); }
    this.leaseStat = fstatSync(this.leaseFd);
    this.afterWrite = () => this.persist();
  }

  withLock(fn) {
    requireValue(!this.failed, 'STORE_RECOVERY_REQUIRED');
    return super.withLock(fn);
  }

  persist() {
    requireValue(!this.failed, 'STORE_RECOVERY_REQUIRED');
    const snapshot = this.snapshot();
    const envelope = { schemaVersion: 1, configDigest: this.configDigest,
      checksum: digest(snapshot), snapshot };
    const temporary = this.file + '.' + randomUUID() + '.pending';
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, canonical(envelope)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.file);
      const dir = openSync(resolve(this.file, '..'), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
    } catch (error) { this.failed = true; throw error; }
  }

  close() {
    if (this.leaseFd !== null) {
      closeSync(this.leaseFd); this.leaseFd = null;
      // 只釋放本 process 建立的暫時租約，不刪除任何業務資料。
      if (existsSync(this.lease)) {
        const actual = lstatSync(this.lease);
        if (actual.ino === this.leaseStat.ino && actual.dev === this.leaseStat.dev) unlinkSync(this.lease);
      }
    }
  }
}
