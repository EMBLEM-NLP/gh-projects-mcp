export function issueCloseReason(reason = 'completed') {
  return reason === 'not_planned' ? 'not planned' : 'completed';
}

export function issueCloseReasonApi(reason = 'completed') {
  return reason === 'not_planned' ? 'not_planned' : 'completed';
}

export function readIssueForLifecycle(ghImpl, owner, repo, number) {
  const raw = ghImpl('api', `repos/${owner}/${repo}/issues/${number}`).stdout;
  const issue = JSON.parse(raw);
  if (issue.pull_request) {
    throw new Error(`Repository item #${number} is a pull request. Use gh_pr_* tools for pull requests.`);
  }
  return issue;
}

export function normalizeIssueLifecycleResult(issue) {
  return {
    id: issue.node_id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    url: issue.html_url ?? issue.url,
    labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
  };
}

export function buildIssueEditArgs({ owner, repo, number, title, body, labels, removeLabels }) {
  const args = ['issue', 'edit', String(number), '--repo', `${owner}/${repo}`];
  if (title !== undefined) args.push('--title', title);
  if (body !== undefined) args.push('--body', body);
  for (const label of labels ?? []) args.push('--add-label', label);
  for (const label of removeLabels ?? []) args.push('--remove-label', label);
  if (args.length === 5) throw new Error('No issue metadata edits were supplied.');
  return args;
}

export function buildIssueCloseArgs({ owner, repo, number, reason }) {
  return ['issue', 'close', String(number), '--repo', `${owner}/${repo}`, '--reason', issueCloseReason(reason)];
}

export function buildIssueReopenArgs({ owner, repo, number }) {
  return ['issue', 'reopen', String(number), '--repo', `${owner}/${repo}`];
}

export function verifyIssueLifecycle(after, { title, body, labels, removeLabels, state, closeReason }) {
  if (title !== undefined && after.title !== title) throw new Error('Issue edit verification failed: title mismatch.');
  if (body !== undefined && (after.body ?? '') !== body) throw new Error('Issue edit verification failed: body mismatch.');
  const names = new Set((after.labels ?? []).map((label) => typeof label === 'string' ? label : label.name));
  for (const label of labels ?? []) {
    if (!names.has(label)) throw new Error(`Issue edit verification failed: label "${label}" was not added.`);
  }
  for (const label of removeLabels ?? []) {
    if (names.has(label)) throw new Error(`Issue edit verification failed: label "${label}" was not removed.`);
  }
  if (state !== undefined && after.state !== state) {
    throw new Error(`Issue lifecycle verification failed: expected state ${state}, got ${after.state}.`);
  }
  if (state === 'closed' && after.state_reason !== issueCloseReasonApi(closeReason)) {
    throw new Error(`Issue lifecycle verification failed: expected close reason ${issueCloseReasonApi(closeReason)}, got ${after.state_reason ?? '<none>'}.`);
  }
  return normalizeIssueLifecycleResult(after);
}
