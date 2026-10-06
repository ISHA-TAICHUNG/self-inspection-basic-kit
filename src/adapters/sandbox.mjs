import { requireValue } from '../domain/common.mjs';

/** 假驗證器僅供命令列測試，不可接到公開 HTTP 或正式部署。 */
export function sandboxIdentity() {
  return {
    authenticate(context) {
      requireValue(context?.kind === 'sandbox-fixture' &&
        /^demo-[a-z0-9-]+$/.test(context.personId), 'IDENTITY_UNVERIFIED');
      return { subject: context.personId };
    }
  };
}

export function sandboxFiles() {
  return {
    createArchive(record) {
      return { id: 'DRAFT-' + record.id, recordId: record.id, status: 'draft_only',
        format: 'json', privateFileAvailable: false };
    }
  };
}
