import { requireValue } from '../domain/common.mjs';

/** activeEmail 只由 Google 執行環境提供，永不從前端取值或退回 effective user。 */
export function googleIdentity(activeEmail, bindings) {
  return { authenticate() {
    requireValue(typeof activeEmail === 'string' && activeEmail.trim(), 'GOOGLE_IDENTITY_UNAVAILABLE');
    const email = activeEmail.trim().toLowerCase();
    const personId = bindings[email];
    requireValue(typeof personId === 'string' && personId, 'NOT_ALLOWLISTED');
    return { subject: personId };
  } };
}
