function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function result(value = '') {
  return { stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '', status: 0 };
}

function projectShape(project) {
  return project ? {
    id: project.id,
    number: project.number,
    title: project.title,
    shortDescription: project.shortDescription,
    readme: project.readme,
    closed: project.closed,
    public: project.public,
    url: project.url,
  } : project;
}

function projectFieldsSelection() {
  return `
    __typename
    ... on ProjectV2Field { id name dataType isIssueField }
    ... on ProjectV2IterationField { id name dataType }
    ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
    ... on ProjectV2MultiSelectField { id name dataType options { id name color description } }
  `;
}

function fieldNameSelection() {
  return `
    ... on ProjectV2Field { id name }
    ... on ProjectV2IterationField { id name }
    ... on ProjectV2SingleSelectField { id name }
    ... on ProjectV2MultiSelectField { id name }
  `;
}

export class ProjectApiCompat {
  constructor(backend) {
    this.backend = backend;
  }

  ownerId(owner) {
    const root = this.backend.ownerRoot(owner);
    const q = `query($login:String!){${root}(login:$login){id}}`;
    const r = this.backend.graphql(q, { login: owner });
    const id = r.data?.[root]?.id;
    if (!id) throw new Error(`Could not resolve owner node id for ${owner}.`);
    return id;
  }

  repositoryId(fullName) {
    const [owner, repo] = String(fullName).split('/');
    if (!owner || !repo) throw new Error(`Expected repository as owner/repo, got ${fullName}.`);
    const q = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id}}`;
    const r = this.backend.graphql(q, { owner, repo });
    const id = r.data?.repository?.id;
    if (!id) throw new Error(`Could not resolve repository ${fullName}.`);
    return id;
  }

  teamId(fullName) {
    const [org, slug] = String(fullName).split('/');
    if (!org || !slug) throw new Error(`Expected team as org/team-slug, got ${fullName}.`);
    const q = `query($org:String!,$slug:String!){organization(login:$org){team(slug:$slug){id}}}`;
    const r = this.backend.graphql(q, { org, slug });
    const id = r.data?.organization?.team?.id;
    if (!id) throw new Error(`Could not resolve team ${fullName}.`);
    return id;
  }

  projectId(owner, number) {
    return this.backend.projectView(owner, number).id;
  }

  createProject(owner, title) {
    const q = `mutation($input:CreateProjectV2Input!){createProjectV2(input:$input){projectV2{id number title shortDescription readme closed public url}}}`;
    return projectShape(this.backend.graphql(q, { input: { ownerId: this.ownerId(owner), title } }).data.createProjectV2.projectV2);
  }

  updateProject(owner, number, patch) {
    const q = `mutation($input:UpdateProjectV2Input!){updateProjectV2(input:$input){projectV2{id number title shortDescription readme closed public url}}}`;
    const input = { projectId: this.projectId(owner, number), ...patch };
    return projectShape(this.backend.graphql(q, { input }).data.updateProjectV2.projectV2);
  }

  copyProject(sourceOwner, number, targetOwner, title, includeDraftIssues) {
    const q = `mutation($input:CopyProjectV2Input!){copyProjectV2(input:$input){projectV2{id number title shortDescription readme closed public url}}}`;
    const input = {
      projectId: this.projectId(sourceOwner, number),
      ownerId: this.ownerId(targetOwner),
      title,
      includeDraftIssues: Boolean(includeDraftIssues),
    };
    return projectShape(this.backend.graphql(q, { input }).data.copyProjectV2.projectV2);
  }

  link(owner, number, { repo, team, unlink = false } = {}) {
    const projectId = this.projectId(owner, number);
    if (repo) {
      const repositoryId = this.repositoryId(repo);
      const mutation = unlink ? 'unlinkProjectV2FromRepository' : 'linkProjectV2ToRepository';
      const inputType = unlink ? 'UnlinkProjectV2FromRepositoryInput' : 'LinkProjectV2ToRepositoryInput';
      const q = `mutation($input:${inputType}!){${mutation}(input:$input){projectV2{id}}}`;
      this.backend.graphql(q, { input: { projectId, repositoryId } });
    }
    if (team) {
      const teamId = this.teamId(team);
      const mutation = unlink ? 'unlinkProjectV2FromTeam' : 'linkProjectV2ToTeam';
      const inputType = unlink ? 'UnlinkProjectV2FromTeamInput' : 'LinkProjectV2ToTeamInput';
      const q = `mutation($input:${inputType}!){${mutation}(input:$input){projectV2{id}}}`;
      this.backend.graphql(q, { input: { projectId, teamId } });
    }
  }

  markTemplate(owner, number, undo) {
    const mutation = undo ? 'unmarkProjectV2AsTemplate' : 'markProjectV2AsTemplate';
    const inputType = undo ? 'UnmarkProjectV2AsTemplateInput' : 'MarkProjectV2AsTemplateInput';
    const q = `mutation($input:${inputType}!){${mutation}(input:$input){projectV2{id template}}}`;
    return this.backend.graphql(q, { input: { projectId: this.projectId(owner, number) } }).data[mutation].projectV2;
  }

  fieldList(owner, number) {
    const root = this.backend.ownerRoot(owner);
    const q = `query($login:String!,$number:Int!,$first:Int!,$after:String){${root}(login:$login){projectV2(number:$number){fields(first:$first,after:$after){nodes{${projectFieldsSelection()}} pageInfo{hasNextPage endCursor} totalCount}}}}`;
    const fields = [];
    let after = null;
    let totalCount = 0;
    do {
      const r = this.backend.graphql(q, { login: owner, number, first: 100, after });
      const conn = r.data?.[root]?.projectV2?.fields;
      if (!conn) throw new Error(`Could not read fields for project #${number}.`);
      fields.push(...(conn.nodes ?? []));
      totalCount = conn.totalCount ?? fields.length;
      after = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
    return { fields, totalCount };
  }

  fieldCreate(owner, number, name, dataType, optionNames = []) {
    if (dataType === 'ITERATION') {
      throw new Error('capability_unavailable: ITERATION field creation requires the current iteration configuration implemented under #57.');
    }
    const q = `mutation($input:CreateProjectV2FieldInput!){createProjectV2Field(input:$input){projectV2Field{${projectFieldsSelection()}}}}`;
    const input = { projectId: this.projectId(owner, number), name, dataType };
    if (dataType === 'SINGLE_SELECT') {
      input.singleSelectOptions = optionNames.map((optionName) => ({ name: optionName, color: 'GRAY', description: '' }));
    }
    return this.backend.graphql(q, { input }).data.createProjectV2Field.projectV2Field;
  }

  fieldDelete(fieldId) {
    const q = `mutation($input:DeleteProjectV2FieldInput!){deleteProjectV2Field(input:$input){projectV2Field{__typename}}}`;
    this.backend.graphql(q, { input: { fieldId } });
  }

  resolveContentId(url) {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
    if (!match) throw new Error(`Unsupported issue/PR URL: ${url}`);
    const [, owner, repo, kind, number] = match;
    const endpoint = kind === 'pull' ? 'pulls' : 'issues';
    const content = this.backend.rest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${endpoint}/${number}`);
    if (!content?.node_id) throw new Error(`Could not resolve node id for ${url}.`);
    return content.node_id;
  }

  itemAdd(owner, number, url) {
    const q = `mutation($input:AddProjectV2ItemByIdInput!){addProjectV2ItemById(input:$input){item{id type isArchived}}}`;
    return this.backend.graphql(q, { input: { projectId: this.projectId(owner, number), contentId: this.resolveContentId(url) } }).data.addProjectV2ItemById.item;
  }

  itemCreate(owner, number, title, body = '') {
    const q = `mutation($input:AddProjectV2DraftIssueInput!){addProjectV2DraftIssue(input:$input){projectItem{id type isArchived content{... on DraftIssue{id title body}}}}}`;
    return this.backend.graphql(q, { input: { projectId: this.projectId(owner, number), title, body } }).data.addProjectV2DraftIssue.projectItem;
  }

  draftEdit(draftIssueId, { title, body }) {
    const q = `mutation($input:UpdateProjectV2DraftIssueInput!){updateProjectV2DraftIssue(input:$input){draftIssue{id title body}}}`;
    const input = { draftIssueId };
    if (title !== undefined) input.title = title;
    if (body !== undefined) input.body = body;
    return this.backend.graphql(q, { input }).data.updateProjectV2DraftIssue.draftIssue;
  }

  itemFieldEdit(projectId, itemId, fieldId, args) {
    if (hasFlag(args, '--clear')) {
      const q = `mutation($input:ClearProjectV2ItemFieldValueInput!){clearProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}`;
      this.backend.graphql(q, { input: { projectId, itemId, fieldId } });
      return;
    }
    const value = {};
    if (flagValue(args, '--text') !== undefined) value.text = flagValue(args, '--text');
    else if (flagValue(args, '--number') !== undefined) value.number = Number(flagValue(args, '--number'));
    else if (flagValue(args, '--date') !== undefined) value.date = flagValue(args, '--date');
    else if (flagValue(args, '--single-select-option-id') !== undefined) value.singleSelectOptionId = flagValue(args, '--single-select-option-id');
    else if (flagValue(args, '--iteration-id') !== undefined) value.iterationId = flagValue(args, '--iteration-id');
    else throw new Error('No supported project item field value flag was supplied.');
    const q = `mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}`;
    this.backend.graphql(q, { input: { projectId, itemId, fieldId, value } });
  }

  itemArchive(owner, number, itemId, undo) {
    const mutation = undo ? 'unarchiveProjectV2Item' : 'archiveProjectV2Item';
    const inputType = undo ? 'UnarchiveProjectV2ItemInput' : 'ArchiveProjectV2ItemInput';
    const q = `mutation($input:${inputType}!){${mutation}(input:$input){item{id isArchived}}}`;
    return this.backend.graphql(q, { input: { projectId: this.projectId(owner, number), itemId } }).data[mutation].item;
  }

  itemDelete(owner, number, itemId) {
    const q = `mutation($input:DeleteProjectV2ItemInput!){deleteProjectV2Item(input:$input){deletedItemId}}`;
    return this.backend.graphql(q, { input: { projectId: this.projectId(owner, number), itemId } }).data.deleteProjectV2Item.deletedItemId;
  }

  itemList(owner, number, limit = 200, queryText = '') {
    const root = this.backend.ownerRoot(owner);
    const fieldName = fieldNameSelection();
    const q = `query($login:String!,$number:Int!,$first:Int!,$after:String,$query:String){${root}(login:$login){projectV2(number:$number){items(first:$first,after:$after,query:$query){nodes{
      id type isArchived createdAt updatedAt
      content{__typename ... on DraftIssue{id title body} ... on Issue{id number title body url state repository{nameWithOwner}} ... on PullRequest{id number title body url state repository{nameWithOwner}}}
      fieldValues(first:100){nodes{
        __typename
        ... on ProjectV2ItemFieldTextValue{text field{${fieldName}}}
        ... on ProjectV2ItemFieldNumberValue{number field{${fieldName}}}
        ... on ProjectV2ItemFieldDateValue{date field{${fieldName}}}
        ... on ProjectV2ItemFieldSingleSelectValue{optionId name color field{${fieldName}}}
        ... on ProjectV2ItemFieldIterationValue{iterationId title startDate duration field{${fieldName}}}
        ... on ProjectV2ItemFieldMultiSelectValue{value options{id name color description} field{${fieldName}}}
      }}
    } pageInfo{hasNextPage endCursor} totalCount}}}}`;
    const items = [];
    let after = null;
    let totalCount = 0;
    do {
      const first = Math.min(100, limit - items.length);
      const r = this.backend.graphql(q, { login: owner, number, first, after, query: queryText || '' });
      const conn = r.data?.[root]?.projectV2?.items;
      if (!conn) throw new Error(`Could not read items for project #${number}.`);
      items.push(...(conn.nodes ?? []).map((item) => ({ ...item, fieldValues: item.fieldValues?.nodes ?? [] })));
      totalCount = conn.totalCount ?? items.length;
      after = conn.pageInfo?.hasNextPage && items.length < limit ? conn.pageInfo.endCursor : null;
    } while (after);
    return { items: items.slice(0, limit), totalCount };
  }

  handle(args) {
    if (args[0] !== 'project') return null;
    const command = args[1];

    if (command === 'create') {
      return result(this.createProject(flagValue(args, '--owner'), flagValue(args, '--title')));
    }
    if (command === 'edit') {
      const owner = flagValue(args, '--owner');
      const number = Number(args[2]);
      const patch = {};
      if (flagValue(args, '--title') !== undefined) patch.title = flagValue(args, '--title');
      if (flagValue(args, '--description') !== undefined) patch.shortDescription = flagValue(args, '--description');
      if (flagValue(args, '--readme') !== undefined) patch.readme = flagValue(args, '--readme');
      if (flagValue(args, '--visibility') !== undefined) patch.public = flagValue(args, '--visibility') === 'PUBLIC';
      return result(this.updateProject(owner, number, patch));
    }
    if (command === 'close') {
      return result(this.updateProject(flagValue(args, '--owner'), Number(args[2]), { closed: !hasFlag(args, '--undo') }));
    }
    if (command === 'copy') {
      return result(this.copyProject(flagValue(args, '--source-owner'), Number(args[2]), flagValue(args, '--target-owner'), flagValue(args, '--title'), hasFlag(args, '--drafts')));
    }
    if (command === 'link' || command === 'unlink') {
      const owner = flagValue(args, '--owner');
      const number = Number(args[2]);
      this.link(owner, number, { repo: flagValue(args, '--repo'), team: flagValue(args, '--team'), unlink: command === 'unlink' });
      return result(command === 'unlink' ? 'Unlinked.' : 'Linked.');
    }
    if (command === 'mark-template') {
      return result(this.markTemplate(flagValue(args, '--owner'), Number(args[2]), hasFlag(args, '--undo')));
    }
    if (command === 'field-list') {
      return result(this.fieldList(flagValue(args, '--owner'), Number(args[2])));
    }
    if (command === 'field-create') {
      const optionNames = (flagValue(args, '--single-select-options') ?? '').split(',').filter(Boolean);
      return result(this.fieldCreate(flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--name'), flagValue(args, '--data-type'), optionNames));
    }
    if (command === 'field-delete') {
      this.fieldDelete(flagValue(args, '--id'));
      return result();
    }
    if (command === 'item-list') {
      return result(this.itemList(flagValue(args, '--owner'), Number(args[2]), Number(flagValue(args, '--limit') ?? 200), flagValue(args, '--query') ?? ''));
    }
    if (command === 'item-add') {
      return result(this.itemAdd(flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--url')));
    }
    if (command === 'item-create') {
      return result(this.itemCreate(flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--title'), flagValue(args, '--body') ?? ''));
    }
    if (command === 'item-edit') {
      const itemId = flagValue(args, '--id');
      const projectId = flagValue(args, '--project-id');
      const fieldId = flagValue(args, '--field-id');
      if (!projectId && !fieldId) return result(this.draftEdit(itemId, { title: flagValue(args, '--title'), body: flagValue(args, '--body') }));
      this.itemFieldEdit(projectId, itemId, fieldId, args);
      return result();
    }
    if (command === 'item-archive') {
      return result(this.itemArchive(flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--id'), hasFlag(args, '--undo')));
    }
    if (command === 'item-delete') {
      return result({ deletedItemId: this.itemDelete(flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--id')) });
    }

    return null;
  }
}

export function handleProjectApiCompat(backend, args) {
  return new ProjectApiCompat(backend).handle(args);
}
