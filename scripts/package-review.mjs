import { spawnSync } from 'node:child_process';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scan = spawnSync(process.execPath, [resolve(root, 'scripts/check-release.mjs')], { cwd: root, encoding: 'utf8' });
if (scan.status !== 0) throw new Error('公開候選檔案檢查未通過，不打包');
const report = JSON.parse(scan.stdout);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const directory = resolve(root, '.release');
await mkdir(directory, { recursive: true });
const archive = resolve(directory, `self-inspection-basic-kit-${pkg.version}-review.zip`);
try {
  await lstat(archive);
  throw new Error('既有審查包不覆寫，請先核對版本');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
// 只交給 zip 明確候選清單，不帶 .local、上層專案或 Git 歷史。
const zipped = spawnSync('zip', ['-q', archive, ...report.candidateFiles], { cwd: root, encoding: 'utf8' });
if (zipped.status !== 0) throw new Error('zip 工具無法完成審查包');
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(resolve(directory, `review-package-receipt-${pkg.version}.json`), JSON.stringify({
  ...report, archiveSha256: sha256, packagePurpose: 'review_only', published: false
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ archive, sha256, fileCount: report.candidateFileCount,
  privateFilesIncluded: false, gitHistoryIncluded: false, published: false }, null, 2));
