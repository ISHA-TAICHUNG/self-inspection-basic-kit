import { readFileSync } from 'node:fs';
import { KitService } from '../src/application/service.mjs';
import { MemoryRepository } from '../src/adapters/memory.mjs';
import { sandboxIdentity } from '../src/adapters/sandbox.mjs';

export const NOW = '2026-10-05T08:00:00Z';
export function example() {
  return JSON.parse(readFileSync(new URL('../config/example.json', import.meta.url), 'utf8'));
}
export function context(personId = 'demo-inspector') { return { kind: 'sandbox-fixture', personId }; }
export function fixture(config = example(), repository = new MemoryRepository()) {
  return { repository, service: new KitService({ config, repository, identity: sandboxIdentity(), clock: () => NOW }) };
}
export function inspection(overrides = {}) {
  return { type: 'inspect', requestId: 'test-inspect-0001', requirementId: 'REQ-FORK-D', templateVersion: 1,
    period: '2026-10-05', actualAt: '2026-10-05T15:00:00+08:00', signatureRef: 'FAKE-SIGNATURE',
    answers: { BRAKE: { result: 'normal', note: '' }, HORN: { result: 'abnormal', note: '示範異常' } },
    ...overrides };
}
export function event(overrides = {}) {
  return { type: 'event', requestId: 'test-event-0001', siteId: 'SITE-A', category: '日常事件',
    urgency: 'general', description: '示範通報', actualAt: '2026-10-05T15:00:00+08:00', ...overrides };
}
export const code = expected => error => error.code === expected;
