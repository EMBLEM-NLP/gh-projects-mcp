import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_API_URL = 'https://api.github.com';

const REQUEST_SCRIPT = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
try {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const raw = await response.text();
  let body = raw;
  if (raw) {
    try { body = JSON.parse(raw); } catch { /* keep text */ }
  }
  process.stdout.write(JSON.stringify({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ transportError: error?.message ?? String(error) }));
  process.exitCode = 1;
}
`;

function apiGraphqlUrl(apiUrl) {
  if (apiUrl === DEFAULT_API_URL) return `${apiUrl}/graphql`;
  if (apiUrl.endsWith('/api/v3')) return `${apiUrl.slice(0, -'/api/v3'.length)}/api/graphql`;
  return `${apiUrl.replace(/\/$/, '')}/graphql`;
}

function parseTypedValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function parseFieldArgs(extra) {
  const variables = {};
  for (let i = 0; i < extra.length; i += 1) {
    const flag = extra[i];
    if (flag !== '-f' && flag !== '-F') continue;
    const pair = extra[i + 1];
    if (typeof pair !== 'string') throw new Error(`${flag} requires key=value`);
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`${flag} requires key=value`);
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    variables[key] = flag === '-F' ? parseTypedValue(value) : value;
    i += 1;
  }
  return variables;
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function simpleJsonPath(value, expression) {
  if (!expression) return value;
  if (!expression.startsWith('.')) throw new Error(`Only simple .field --jq expressions are supported by the API backend: ${expression}`);
  const parts = expression.slice(1).split('.').filter(Boolean);
  let current = value;
  for (const part of parts) current = current?.[part];
  return current;
}

export function requestJsonSync(request, { spawn = spawnSync } = {}) {
  const result = spawn(process.execPath, ['--input-type=module', '--eval', REQUEST_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify(request),
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  let envelope;
  try {
    envelope = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(`GitHub API request runner returned invalid JSON: ${result.stdout?.slice(0, 500)}`);
  }
  if (envelope.transportError) throw new Error(`GitHub API transport error: ${envelope.transportError}`);
  if (!envelope.ok) {
    const detail = typeof envelope.body === 'string' ? envelope.body : JSON.stringify(envelope.body);
    throw new Error(`GitHub API ${envelope.status} ${envelope.statusText}: ${detail}`);
  }
  return envelope.body;
}

export class GhCliBackend {
  constructor({ spawn = spawnSync } = {}) {
    this.kind = 'gh-cli';
    this.spawn = spawn;
  }

  gh(...args) {
    const result = this.spawn('gh', args, { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr?.trim()}`);
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), status: result.status };
  }

  gql(query, ...extra) {
    const result = this.spawn('gh', ['api', 'graphql', '-f', `query=${query}`, ...extra], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`gh api graphql failed: ${result.stderr?.trim()}`);
    const parsed = JSON.parse(result.stdout);
    if (parsed.errors) throw new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`);
    return parsed;
  }

  capabilities() {
    return { backend: this.kind, requiresGhCli: true, directApi: false };
  }
}

export class GitHubApiBackend {
  constructor({
    token,
    apiUrl = DEFAULT_API_URL,
    graphqlUrl = apiGraphqlUrl(apiUrl),
    request = requestJsonSync,
  } = {}) {
    if (!token) throw new Error('GitHub API backend requires GH_PROJECTS_TOKEN or GITHUB_TOKEN.');
    this.kind = 'github-api';
    this.token = token;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.graphqlUrl = graphqlUrl;
    this.request = request;
    this.ownerTypeCache = new Map();
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gh-projects-mcp',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  rest(method, path, body) {
    const url = path.startsWith('http') ? path : `${this.apiUrl}/${path.replace(/^\//, '')}`;
    return this.request({ method, url, headers: this.headers(), body });
  }

  graphql(query, variables = {}) {
    const parsed = this.request({
      method: 'POST',
      url: this.graphqlUrl,
      headers: this.headers(),
      body: { query, variables },
    });
    if (parsed?.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`);
    return parsed;
  }

  gql(query, ...extra) {
    return this.graphql(query, parseFieldArgs(extra));
  }

  ownerType(owner) {
    if (this.ownerTypeCache.has(owner)) return this.ownerTypeCache.get(owner);
    const user = this.rest('GET', `/users/${encodeURIComponent(owner)}`);
    const type = user?.type === 'Organization' ? 'Organization' : 'User';
    this.ownerTypeCache.set(owner, type);
    return type;
  }

  ownerRoot(owner) {
    return this.ownerType(owner) === 'Organization' ? 'organization' : 'user';
  }

  projectList(owner) {
    const root = this.ownerRoot(owner);
    const query = `query($login:String!,$first:Int!,$after:String){
      ${root}(login:$login){
        projectsV2(first:$first,after:$after){
          nodes { id number title shortDescription readme closed public url createdAt updatedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`;
    const projects = [];
    let after = null;
    do {
      const response = this.graphql(query, { login: owner, first: 100, after });
      const connection = response.data?.[root]?.projectsV2;
      if (!connection) throw new Error(`Could not resolve Projects v2 owner: ${owner}`);
      projects.push(...(connection.nodes ?? []));
      after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    return { projects, totalCount: projects.length };
  }

  projectView(owner, number, { allowMissing = false } = {}) {
    const root = this.ownerRoot(owner);
    const query = `query($login:String!,$number:Int!){
      ${root}(login:$login){
        projectV2(number:$number){
          id number title shortDescription readme closed public url createdAt updatedAt
          items(first:1){ totalCount }
          fields(first:1){ totalCount }
          views(first:20){ nodes { id name number createdAt updatedAt layout filter } }
        }
      }
    }`;
    const response = this.graphql(query, { login: owner, number });
    const project = response.data?.[root]?.projectV2 ?? null;
    if (!project && !allowMissing) throw new Error(`Project #${number} was not found for ${owner}.`);
    if (!project) return null;
    return {
      ...project,
      owner: { login: owner, type: this.ownerType(owner) },
      views: project.views?.nodes ?? [],
    };
  }

  deleteProject(owner, number) {
    const project = this.projectView(owner, number);
    const mutation = `mutation($projectId:ID!){
      deleteProjectV2(input:{projectId:$projectId}){ projectV2 { id } }
    }`;
    this.graphql(mutation, { projectId: project.id });
    const remaining = this.projectView(owner, number, { allowMissing: true });
    if (remaining) throw new Error(`Project #${number} still exists after deleteProjectV2.`);
    return project.id;
  }

  authStatus() {
    const response = this.graphql('query { viewer { login } rateLimit { remaining resetAt } }');
    return {
      backend: this.kind,
      authenticatedAs: response.data?.viewer?.login ?? null,
      rateLimit: response.data?.rateLimit ?? null,
    };
  }

  gh(...args) {
    if (args[0] === 'auth' && args[1] === 'status') {
      return { stdout: JSON.stringify(this.authStatus()), stderr: '', status: 0 };
    }

    if (args[0] === 'api') {
      if (args[1] === 'graphql') {
        const fields = parseFieldArgs(args.slice(2));
        const query = fields.query;
        if (!query) throw new Error('gh api graphql compatibility call is missing query=.');
        delete fields.query;
        return { stdout: JSON.stringify(this.graphql(query, fields)), stderr: '', status: 0 };
      }
      const value = this.rest('GET', args[1]);
      const jq = flagValue(args, '--jq');
      const selected = simpleJsonPath(value, jq);
      return {
        stdout: typeof selected === 'string' ? selected : JSON.stringify(selected),
        stderr: '',
        status: 0,
      };
    }

    if (args[0] === 'project' && args[1] === 'list') {
      const owner = flagValue(args, '--owner');
      if (!owner) throw new Error('project list requires --owner in GitHub API backend mode.');
      return { stdout: JSON.stringify(this.projectList(owner)), stderr: '', status: 0 };
    }

    if (args[0] === 'project' && args[1] === 'view') {
      const owner = flagValue(args, '--owner');
      const number = Number(args[2]);
      if (!owner || !Number.isInteger(number)) throw new Error('project view requires project number and --owner.');
      return { stdout: JSON.stringify(this.projectView(owner, number)), stderr: '', status: 0 };
    }

    if (args[0] === 'project' && args[1] === 'delete') {
      const owner = flagValue(args, '--owner');
      const number = Number(args[2]);
      if (!owner || !Number.isInteger(number)) throw new Error('project delete requires project number and --owner.');
      this.deleteProject(owner, number);
      return { stdout: '', stderr: '', status: 0 };
    }

    throw new Error(`capability_unavailable: GitHub API backend does not yet implement gh ${args.join(' ')}`);
  }

  capabilities() {
    return {
      backend: this.kind,
      requiresGhCli: false,
      directApi: true,
      mappedGhCommands: ['auth status', 'api', 'project list', 'project view', 'project delete'],
    };
  }
}

export function createBackend({ mode, env = process.env, spawn, request } = {}) {
  const selected = mode ?? env.GH_PROJECTS_BACKEND ?? 'auto';
  const token = env.GH_PROJECTS_TOKEN ?? env.GITHUB_TOKEN;

  if (selected === 'gh-cli') return new GhCliBackend({ spawn });
  if (selected === 'api' || selected === 'github-api') {
    return new GitHubApiBackend({
      token,
      apiUrl: env.GH_PROJECTS_API_URL ?? DEFAULT_API_URL,
      graphqlUrl: env.GH_PROJECTS_GRAPHQL_URL,
      request,
    });
  }
  if (selected === 'auto') {
    if (token) {
      return new GitHubApiBackend({
        token,
        apiUrl: env.GH_PROJECTS_API_URL ?? DEFAULT_API_URL,
        graphqlUrl: env.GH_PROJECTS_GRAPHQL_URL,
        request,
      });
    }
    return new GhCliBackend({ spawn });
  }
  throw new Error(`Unknown GH_PROJECTS_BACKEND value: ${selected}. Use auto, gh-cli, or api.`);
}
