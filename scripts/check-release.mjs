import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowedRoots = new Set(['src', 'scripts', 'tests', 'config', 'docs', 'prompts', 'web', 'gas', 'pdf']);
const allowedFiles = new Set(['README.md', 'START_HERE.md', 'ARCHITECTURE.md', 'SETUP_FOR_AI.md',
  'AGENTS.md', 'package.json', '.gitignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
const ignored = new Set(['.local', '.release', '.git', 'node_modules', '.DS_Store']);
const files = [];
const findings = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && ignored.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute).split(sep).join('/');
    const first = path.split('/')[0];
    if (directory === root && !allowedRoots.has(first) && !allowedFiles.has(path)) {
      findings.push({ path, code: 'NOT_ALLOWLISTED' }); continue;
    }
    if ((await lstat(absolute)).isSymbolicLink()) {
      findings.push({ path, code: 'SYMLINK_REJECTED' }); continue;
    }
    if (entry.isDirectory()) await walk(absolute);
    else {
      if (!(await realpath(absolute)).startsWith(root + sep)) {
        findings.push({ path, code: 'OUTSIDE_ROOT' }); continue;
      }
      if (!/\.(mjs|md|json|html|css|gs|py)$/.test(path) && !allowedFiles.has(path)) {
        findings.push({ path, code: 'FILE_TYPE_REJECTED' }); continue;
      }
      files.push(path);
      const content = await readFile(absolute, 'utf8');
      const patterns = [
        ['GOOGLE_PRIVATE_LINK', /https?:\/\/(?:docs|drive)\.google\.com\/[^\s)"']+/],
        ['LINE_USER_ID', /\bU[0-9a-f]{32}\b/i],
        ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ['GITHUB_CREDENTIAL', /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/],
        ['GOOGLE_CREDENTIAL', /\b(?:AIza[\w-]{30,}|ya29\.[\w.-]{20,})\b/],
        ['ASSIGNED_SECRET', /(?:password|api[_-]?key|channel[_-]?access[_-]?token|admin[_-]?key)\s*[=:]\s*["'][^"']{8,}["']/i],
        ['REAL_EMAIL', /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|invalid)\b|invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i]
      ];
      for (const [code, pattern] of patterns) if (pattern.test(content)) findings.push({ path, code });
    }
  }
}
await walk(root);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const licenseExists = files.includes('LICENSE');
const licenseApproved = pkg.license === 'MIT' && licenseExists;
console.log(JSON.stringify({ sourceCheck: findings.length ? 'FAIL' : 'PASS',
  intendedOwner: 'ISHA-TAICHUNG', suggestedRepository: 'self-inspection-basic-kit',
  candidateFileCount: files.length, candidateFiles: files.sort(), findings,
  publishGate: licenseApproved ? 'REQUIRES_ACCOUNT_HISTORY_AND_REVIEW' : 'BLOCKED_LICENSE_PENDING',
  historyScanned: false, cloudAcceptance: false, externalWrites: 0,
  limitations: ['樣式規則掃描不是完整資安審查', '只掃本目錄候選檔，不掃 GitHub 歷史或私人資料', '不執行發布']
}, null, 2));
if (findings.length || (process.argv.includes('--publish-check') && !licenseApproved)) process.exitCode = 1;
