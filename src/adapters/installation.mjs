import { existsSync, mkdirSync, lstatSync, chmodSync, readFileSync, readdirSync, openSync, writeFileSync,
  closeSync, fsyncSync, linkSync, unlinkSync, fstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, requireValue } from '../domain/common.mjs';
import { validateConfig } from '../domain/config.mjs';
import { FileSandboxRepository } from './file-sandbox.mjs';

function privateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'INSTALL_PATH_INVALID');
  chmodSync(directory, 0o700);
}

function readPrivateJson(file) {
  const stat = lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    (stat.mode & 0o077) === 0, 'INSTALL_FILE_NOT_PRIVATE');
  return JSON.parse(readFileSync(file, 'utf8'));
}

// 以 link 的排他建立發佈完整檔案，不覆寫已存在的設定或安裝收據。
function ensureJson(file, value) {
  if (existsSync(file)) {
    requireValue(canonical(readPrivateJson(file)) === canonical(value), 'INSTALL_CONTENT_CONFLICT');
    return;
  }
  const temporary = file + '.' + randomUUID() + '.pending';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, canonical(value)); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    linkSync(temporary, file);
  } finally {
    // temporary 是這次操作剛建立的檔案，不刪除既有設定與業務紀錄。
    unlinkSync(temporary);
  }
  const directoryFd = openSync(resolve(file, '..'), 'r');
  try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  requireValue(canonical(readPrivateJson(file)) === canonical(value), 'INSTALL_READBACK_FAILED');
}

function sandboxConfig(value) {
  const config = validateConfig(value);
  requireValue(config.people.some(person => person.active && person.roles.includes('inspect')),
    'INSPECTOR_REQUIRED');
  requireValue(config.templates.every(template => template.items.every(item => item.photoPolicy === 'none')),
    'PHOTO_NOT_IMPLEMENTED');
  return config;
}

/** 只回傳核定所需的摘要；不輸出完整設定、人員或綁定。 */
export function installationPlan(value) {
  const config = sandboxConfig(value);
  return { installationVersion: 1, environment: 'loopback_sandbox',
    configDigest: digest(config), schemaVersion: config.schemaVersion,
    equipmentCount: config.equipment.length, templateCount: config.templates.length,
    peopleCount: config.people.length, dailyCount: config.requirements.filter(row => row.active &&
      row.cycle === 'daily').length, monthlyCount: config.requirements.filter(row => row.active &&
      row.cycle === 'monthly').length, lineSent: 0, production: false };
}

/** 讀取已核定設定，不以壞掉的安裝檔降級成範例或假成功。 */
export function loadInstallation(directory, { allowUnactivated = false } = {}) {
  const home = resolve(directory);
  requireValue(!lstatSync(home).isSymbolicLink(), 'INSTALL_PATH_INVALID');
  const pointer = join(home, 'active-installation.json');
  if (!existsSync(pointer)) {
    requireValue(allowUnactivated || !existsSync(join(home, 'installations')), 'INSTALL_ACTIVATION_REQUIRED');
    return null;
  }
  const active = readPrivateJson(pointer);
  requireValue(active.installationVersion === 1 && /^[a-f0-9]{64}$/.test(active.configDigest) &&
    active.environment === 'loopback_sandbox', 'INSTALL_MANIFEST_INVALID');
  const installationDirectory = join(home, 'installations', active.configDigest);
  for (const path of [join(home, 'installations'), installationDirectory]) {
    requireValue(!lstatSync(path).isSymbolicLink(), 'INSTALL_PATH_INVALID');
  }
  const saved = readPrivateJson(join(installationDirectory, 'config.json'));
  const config = sandboxConfig(saved.config);
  requireValue(saved.schemaVersion === 1 && saved.configDigest === active.configDigest &&
    digest(config) === active.configDigest, 'INSTALL_CONFIG_CHANGED');
  requireValue(canonical(readPrivateJson(join(installationDirectory, 'receipt.json'))) ===
    canonical(installationPlan(config)), 'INSTALL_RECEIPT_INVALID');
  const dataDirectory = join(installationDirectory, 'data');
  requireValue(!lstatSync(dataDirectory).isSymbolicLink(), 'INSTALL_PATH_INVALID');
  const state = readPrivateJson(join(dataDirectory, 'state.json'));
  requireValue(state.schemaVersion === 1 && state.configDigest === active.configDigest &&
    state.checksum === digest(state.snapshot), 'INSTALL_STATE_INVALID');
  return { config, dataDirectory, configDigest: active.configDigest };
}

/** 核定摘要後只建立本機隔離安裝；同設定可重跑，不原地換設定。 */
export function applyInstallation(value, { directory, approvedDigest }) {
  const config = sandboxConfig(value);
  const plan = installationPlan(config);
  requireValue(approvedDigest === plan.configDigest, 'INSTALL_APPROVAL_REQUIRED');
  const home = resolve(directory);
  privateDirectory(home);
  const lease = join(home, 'installer.lock');
  let fd;
  try { fd = openSync(lease, 'wx', 0o600); }
  catch { requireValue(false, 'INSTALLER_BUSY'); }
  const leaseStat = fstatSync(fd);
  try {
    const current = loadInstallation(home, { allowUnactivated: true });
    if (current) {
      requireValue(current.configDigest === plan.configDigest, 'INSTALL_CONFIG_MIGRATION_REQUIRED');
      return { ...plan, applied: true, reused: true, readback: true };
    }
    const installations = join(home, 'installations');
    const installationDirectory = join(installations, plan.configDigest);
    privateDirectory(installations);
    requireValue(readdirSync(installations).every(name => name === plan.configDigest),
      'INSTALL_CONFIG_MIGRATION_REQUIRED');
    privateDirectory(installationDirectory);
    ensureJson(join(installationDirectory, 'config.json'), {
      schemaVersion: 1, configDigest: plan.configDigest, config });
    const repository = new FileSandboxRepository(join(installationDirectory, 'data'), config);
    try { repository.withLock(() => repository.persist()); } finally { repository.close(); }
    ensureJson(join(installationDirectory, 'receipt.json'), plan);
    ensureJson(join(home, 'active-installation.json'), {
      installationVersion: 1, environment: plan.environment, configDigest: plan.configDigest });
    requireValue(loadInstallation(home)?.configDigest === plan.configDigest, 'INSTALL_READBACK_FAILED');
    return { ...plan, applied: true, reused: false, readback: true };
  } finally {
    closeSync(fd);
    if (existsSync(lease)) {
      const stat = lstatSync(lease);
      if (stat.ino === leaseStat.ino && stat.dev === leaseStat.dev) unlinkSync(lease);
    }
  }
}
