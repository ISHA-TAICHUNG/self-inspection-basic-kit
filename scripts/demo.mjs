import { readFile } from 'node:fs/promises';
import { KitService } from '../src/application/service.mjs';
import { MemoryRepository } from '../src/adapters/memory.mjs';
import { sandboxIdentity } from '../src/adapters/sandbox.mjs';

const config = JSON.parse(await readFile(new URL('../config/example.json', import.meta.url)));
const repository = new MemoryRepository();
const service = new KitService({ config, repository, identity: sandboxIdentity(),
  clock: () => '2026-10-05T08:00:00Z' });
const as = personId => ({ kind: 'sandbox-fixture', personId });
const inspection = service.execute(as('demo-inspector'), {
  requestId: 'demo-check-0001', type: 'inspect', requirementId: 'REQ-FORK-D', templateVersion: 1,
  period: '2026-10-05', actualAt: '2026-10-05T15:00:00+08:00', signatureRef: 'FAKE-SIGNATURE',
  answers: { BRAKE: { result: 'normal', note: '' }, HORN: { result: 'abnormal', note: '示範異常，待檢修' } }
});
const caseId = inspection.caseIds[0];
const preview = service.notificationPreview(as('demo-admin'), caseId);
service.execute(as('demo-handler'), { requestId: 'demo-claim-0001', type: 'claim', caseId, expectedVersion: 1, expectedStatus: 'pending' });
service.execute(as('demo-handler'), { requestId: 'demo-report-0001', type: 'report', caseId, expectedVersion: 2,
  expectedStatus: 'in_progress', description: '示範：檢修並回報，非真實設備紀錄', completedDate: '2026-10-05' });
service.execute(as('demo-confirm'), { requestId: 'demo-confirm-0001', type: 'confirm', caseId, expectedVersion: 3,
  expectedStatus: 'awaiting_confirmation', comment: '示範確認，不作實際復測證據' });
service.execute(as('demo-inspector'), { requestId: 'demo-event-0001', type: 'event', siteId: 'SITE-A',
  category: '課程影響', urgency: 'urgent', description: '隔離測試的事件通報', actualAt: '2026-10-05T15:30:00+08:00' });
const dashboard = service.dashboard(as('demo-admin'));
console.log(JSON.stringify({
  mode: 'sandbox', externalRequests: 0, equipmentCount: config.equipment.length,
  inspectionStatus: inspection.status, originalRecipientCount: preview.eligible.length,
  recipientIds: preview.eligible.map(row => row.personId),
  closedEquipmentCases: dashboard.cases.filter(row => row.kind === 'equipment' && row.status === 'closed').length,
  pendingEvents: dashboard.cases.filter(row => row.kind === 'event' && row.status === 'reported').length,
  uniqueCompletedRequirements: dashboard.uniqueCompletedRequirements,
  archive: repository.list('archives').map(row => ({ status: row.status, format: row.format })),
  lineSent: 0, realPdfCreated: 0
}, null, 2));
