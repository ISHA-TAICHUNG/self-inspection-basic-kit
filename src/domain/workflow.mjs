import { requireValue, nonempty, localDate } from './common.mjs';
import { authorize, canView, canHandle } from './authorization.mjs';
import { validateCompletionDate } from './inspection.mjs';

/** 案件狀態純函式，管理角色不自動取得處理或確認權。 */
export function transition(config, person, item, command, now) {
  requireValue(canView(person, item), 'FORBIDDEN');
  requireValue(command.expectedVersion === item.version && command.expectedStatus === item.status, 'VERSION_CONFLICT');
  const next = structuredClone(item);
  let notificationEvent = null;
  switch (command.type) {
    case 'claim':
      authorize(person, 'handle', item.siteId);
      requireValue(['pending', 'reported'].includes(item.status), 'STATE_CONFLICT');
      next.status = 'in_progress';
      next.handlerId = person.id;
      break;
    case 'takeover': {
      authorize(person, 'handle', item.siteId);
      requireValue(item.status === 'in_progress', 'STATE_CONFLICT');
      const previous = config.people.find(row => row.id === item.handlerId);
      requireValue(previous, 'HANDLER_UNKNOWN');
      requireValue(!canHandle(previous, item, now), 'HANDLER_STILL_ELIGIBLE');
      requireValue(nonempty(command.reason), 'REASON_REQUIRED');
      next.handlerId = person.id;
      break;
    }
    case 'report':
      authorize(person, 'handle', item.siteId);
      requireValue(item.status === 'in_progress' && item.handlerId === person.id, 'NOT_CURRENT_HANDLER');
      requireValue(nonempty(command.description), 'HANDLING_DESCRIPTION_REQUIRED');
      validateCompletionDate(command.completedDate, now, config.timeZone);
      requireValue(command.completedDate >= localDate(item.openedAt ?? item.receivedAt, config.timeZone), 'COMPLETION_DATE_BEFORE_CASE');
      next.status = 'awaiting_confirmation';
      next.handling = { description: command.description, completedDate: command.completedDate, handlerId: person.id };
      notificationEvent = 'awaiting_confirmation';
      break;
    case 'confirm':
      authorize(person, 'confirm', item.siteId);
      requireValue(item.status === 'awaiting_confirmation', 'STATE_CONFLICT');
      requireValue(config.allowSelfConfirmation || item.handlerId !== person.id, 'SELF_CONFIRMATION_DENIED');
      requireValue(nonempty(command.comment), 'COMMENT_REQUIRED');
      next.status = 'closed';
      next.confirmation = { personId: person.id, comment: command.comment, confirmedAt: now };
      break;
    case 'return':
    case 'reopen':
      authorize(person, 'confirm', item.siteId);
      requireValue(item.status === (command.type === 'return' ? 'awaiting_confirmation' : 'closed'), 'STATE_CONFLICT');
      requireValue(nonempty(command.reason), 'REASON_REQUIRED');
      next.status = 'in_progress';
      notificationEvent = command.type === 'return' ? 'returned' : 'reopened';
      break;
    default:
      requireValue(false, 'ACTION_NOT_SUPPORTED');
  }
  next.version += 1;
  return { next, notificationEvent };
}
