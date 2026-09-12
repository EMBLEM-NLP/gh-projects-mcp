import { readFileSync } from 'node:fs';

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function flagValues(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function splitRepo(fullName) {
  const slash = fullName?.indexOf('/');
  if (!fullName || slash < 1 || slash === fullName.length - 1) {
    throw new Error(`Expected repository as owner/repo, got: ${fullName ?? '<missing>'}`);
  }
  return { owner: fullName.slice(0, slash), repo: fullName.slice(slash + 1) };
}

function issuePath(owner, repo, number) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
}

function closeReasonValue(reason) {
  if (reason === undefined || reason === 'completed') return 'completed';
  if (reason === 'not planned' || reason === 'not_planned') return 'not_planned';
  throw new Error(`Unsupported issue close reason: ${reason}`);
}

function labelNames(issue) {
  return (issue?.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean);
}

/**
 * Direct-API compatibility for issue lifecycle commands used by the MCP.
 * Returns null when the command is outside this compatibility surface.
 */
export function handleIssueApiCompat(backend, args) {
  if (args[0] !== 'issue' || !['edit', 'close', 'reopen'].includes(args[1])) return null;

  const { owner, repo } = splitRepo(flagValue(args, '--repo'));
  const number = Number(args[2]);
  if (!Number.isInteger(number) || number < 1) throw new Error('Issue lifecycle commands require a positive issue number.');
  const path = issuePath(owner, repo, number);

  if (args[1] === 'edit') {
    const patch = {};
    const title = flagValue(args, '--title');
    const bodyFile = flagValue(args, '--body-file');
    const bodyValue = flagValue(args, '--body');
    const addLabels = flagValues(args, '--add-label');
    const removeLabels = flagValues(args, '--remove-label');

    if (title !== undefined) patch.title = title;
    if (bodyFile !== undefined) patch.body = readFileSync(bodyFile, 'utf8');
    else if (bodyValue !== undefined) patch.body = bodyValue;

    if (addLabels.length || removeLabels.length) {
      const current = backend.rest('GET', path);
      const labels = new Set(labelNames(current));
      for (const label of addLabels) labels.add(label);
      for (const label of removeLabels) labels.delete(label);
      patch.labels = [...labels];
    }

    if (!Object.keys(patch).length) throw new Error('issue edit received no editable fields.');
    const issue = backend.rest('PATCH', path, patch);
    return { stdout: JSON.stringify(issue), stderr: '', status: 0 };
  }

  if (args[1] === 'close') {
    const reason = closeReasonValue(flagValue(args, '--reason'));
    const issue = backend.rest('PATCH', path, { state: 'closed', state_reason: reason });
    return { stdout: JSON.stringify(issue), stderr: '', status: 0 };
  }

  const issue = backend.rest('PATCH', path, { state: 'open', state_reason: 'reopened' });
  return { stdout: JSON.stringify(issue), stderr: '', status: 0 };
}
