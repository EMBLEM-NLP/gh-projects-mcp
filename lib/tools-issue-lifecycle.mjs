import { z } from 'zod';
import { gh } from './gql.mjs';
import { assertConfirmed } from './helpers.mjs';
import { executeIssueMetadataEdit, executeIssueStateChange } from './issue-lifecycle.mjs';

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message ?? String(error) }] };
}

export function registerIssueLifecycleTools(server) {
  server.tool(
    'gh_issue_edit',
    'Edit a repository issue and verify final state. Title/body/labels are non-destructive; closing through state=closed requires confirm:true. Pull-request numbers are refused.',
    {
      owner: z.string().describe('Repository owner login'),
      repo: z.string().describe('Repository name without owner'),
      number: z.number().int().positive().describe('Issue number'),
      title: z.string().optional().describe('New issue title'),
      body: z.string().optional().describe('New issue body'),
      labels: z.array(z.string()).optional().describe('Labels to add without removing unrelated labels'),
      removeLabels: z.array(z.string()).optional().describe('Labels to remove'),
      state: z.enum(['open', 'closed']).optional().describe('Reopen or close the issue'),
      closeReason: z.enum(['completed', 'not_planned']).optional().describe('Close reason when state=closed'),
      confirm: z.boolean().optional().describe('Required when state=closed'),
    },
    async (params) => {
      try {
        const hasMetadata = [params.title, params.body, params.labels, params.removeLabels].some((value) => value !== undefined);
        if (!hasMetadata && params.state === undefined) throw new Error('Nothing to edit — pass title/body/labels/removeLabels/state.');
        if (params.closeReason !== undefined && params.state !== 'closed') throw new Error('closeReason is only valid when state is closed.');
        if (params.state === 'closed') assertConfirmed(params.confirm, 'close issue');
        let result;
        if (hasMetadata) {
          result = executeIssueMetadataEdit(gh, {
            owner: params.owner, repo: params.repo, number: params.number,
            title: params.title, body: params.body, labels: params.labels, removeLabels: params.removeLabels,
          });
        }
        if (params.state !== undefined) result = executeIssueStateChange(gh, params);
        return text(result);
      } catch (error) {
        return errorText(error);
      }
    },
  );

  return server;
}
