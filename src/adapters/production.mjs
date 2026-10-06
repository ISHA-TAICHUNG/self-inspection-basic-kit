import { KitError } from '../domain/common.mjs';

function blocked() {
  throw new KitError('PRODUCTION_NOT_IMPLEMENTED', '尚未完成正式身分、私有儲存與 LINE 驗收');
}

// 明確拒絕，而不是偷偷以姓名、假帳號或公開資料夾繼續執行。
export const productionAdapters = Object.freeze({
  authenticate: blocked,
  repository: blocked,
  archive: blocked,
  notify: blocked,
  deploy: blocked
});
