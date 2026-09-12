export function issueCloseReason(reason = 'completed') {
  return reason === 'not_planned' ? 'not planned' : 'completed';
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
