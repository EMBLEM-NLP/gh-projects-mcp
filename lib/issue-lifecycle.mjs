export function issueCloseReason(reason = 'completed') {
  return reason === 'not_planned' ? 'not planned' : 'completed';
}
