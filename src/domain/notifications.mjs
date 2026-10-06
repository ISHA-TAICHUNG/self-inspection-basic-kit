import { isActive, canView } from './authorization.mjs';

function ruleMatches(rule, item, event) {
  const scope = rule.scope;
  return rule.active && rule.event === event &&
    (rule.urgency === 'all' || item.urgency === 'urgent') &&
    (scope.all === true || scope.siteIds?.includes(item.siteId) || scope.equipmentIds?.includes(item.equipmentId));
}

/** 僅計算預覽，不呼叫 LINE；名單不可降級成全員。 */
export function previewRecipients(config, item, event, now) {
  const rules = config.notificationRules.filter(rule => ruleMatches(rule, item, event));
  const eligible = [];
  const excluded = [];
  for (const person of config.people) {
    const matched = rules.filter(rule => person.roles.some(role => rule.roles.includes(role)));
    if (matched.length === 0) continue;
    let reason = null;
    if (!isActive(person, now)) reason = 'inactive';
    else if (!canView(person, item)) reason = 'no_view_permission';
    else if (event === 'awaiting_confirmation' && !person.roles.includes('confirm')) reason = 'no_confirmation_role';
    else if (['returned', 'reopened'].includes(event) &&
      (item.handlerId !== person.id || !person.roles.includes('handle'))) reason = 'not_current_handler';
    else if (!person.lineBinding) reason = 'not_bound';
    if (reason) excluded.push({ personId: person.id, reason });
    else eligible.push({ personId: person.id, binding: person.lineBinding, ruleIds: matched.map(rule => rule.id) });
  }
  return { eligible, excluded, reason: rules.length === 0 ? 'no_rule' : eligible.length === 0 ? 'no_recipient' : null };
}

/** 發送前只取原名單與目前合格者交集，綁定不能偷換。 */
export function recheckRecipients(config, task, item, now) {
  const current = previewRecipients(config, item, task.event, now).eligible;
  return task.originalRecipients.filter(original => current.some(person =>
    person.personId === original.personId && person.binding === original.binding));
}

/** 假 API 回應分類；API 接受證據不等於實際送達或已讀。 */
export function classifyResponse(previous, response) {
  if (previous.status === 'api_accepted') return structuredClone(previous);
  const possible = Boolean(previous.possibleAcceptance);
  if (response.status >= 200 && response.status < 300 && response.requestId) {
    return { status: 'api_accepted', possibleAcceptance: false, acceptedRequestId: response.requestId };
  }
  if (response.status === 409 && response.acceptedRequestId) {
    return { status: 'api_accepted', possibleAcceptance: false, acceptedRequestId: response.acceptedRequestId };
  }
  if (response.status === 409 || (response.status >= 200 && response.status < 300)) {
    return { status: 'unknown', possibleAcceptance: true, reason: 'acceptance_evidence_missing' };
  }
  if (response.status === 0 || response.status >= 500) {
    return { status: 'retry_pending', possibleAcceptance: true, reason: 'timeout_or_server_error' };
  }
  if (response.status === 429) {
    return { status: response.category === 'rate_limit' ? 'retry_pending' : possible ? 'unknown' : 'needs_configuration',
      possibleAcceptance: possible, reason: response.category === 'rate_limit' ? 'rate_limit' : 'channel_paused' };
  }
  return { status: possible ? 'unknown' : 'needs_configuration', possibleAcceptance: possible, reason: 'request_rejected' };
}
