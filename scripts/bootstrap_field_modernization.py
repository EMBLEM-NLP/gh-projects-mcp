from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


server_path = ROOT / 'server.mjs'
server = server_path.read_text()

# The bootstrap is idempotent so the workflow can safely run once more after its generated commit.
if "./lib/field-mutations.mjs" not in server:
    server = replace_once(
        server,
        "import { gqlStr, makeOwnerRoot, assertConfirmed, guardOptionRemoval } from './lib/helpers.mjs';",
        "import { gqlStr, makeOwnerRoot, assertConfirmed } from './lib/helpers.mjs';\n"
        "import { createProjectField, updateSelectFieldOptions, configureIterationField, updateMultiSelectItemField } from './lib/field-mutations.mjs';",
        'server field-mutation import',
    )
    server = replace_once(
        server,
        "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.4.0' });",
        "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.5.0' });",
        'server version',
    )

    field_create = r'''server.tool(
  'gh_project_field_create',
  'Create a custom Project field. TEXT/NUMBER/DATE/SINGLE_SELECT/MULTI_SELECT/ITERATION are supported through GraphQL; select fields require options and iteration fields require iterationConfiguration.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    name: z.string().describe('Field name'),
    dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION']).describe('Field data type'),
    options: z.array(z.string()).optional().describe('Option labels — required for SINGLE_SELECT and MULTI_SELECT'),
    iterationConfiguration: z.object({
      startDate: z.string().describe('Start date of the first iteration, YYYY-MM-DD'),
      duration: z.number().int().positive().describe('Default iteration cadence in days'),
      iterations: z.array(z.object({
        startDate: z.string().describe('ISO date YYYY-MM-DD'),
        duration: z.number().int().positive().describe('Length in days'),
        title: z.string().optional().describe('Iteration title; defaults to Iteration N'),
      })).min(1),
    }).optional().describe('Required when dataType is ITERATION'),
  },
  async ({ owner, number, name, dataType, options, iterationConfiguration }) => safe(() => {
    return text(createProjectField(gql, ownerRoot, { owner, number, name, dataType, options, iterationConfiguration }));
  }),
);

'''
    server = replace_between(
        server,
        "server.tool(\n  'gh_project_field_create',",
        "server.tool(\n  'gh_project_field_option_update',",
        field_create,
        'field create tool',
    )

    option_update = r'''server.tool(
  'gh_project_field_option_update',
  'Safely replace SINGLE_SELECT or MULTI_SELECT options while preserving existing option IDs. Pass the COMPLETE desired option set. Existing IDs are preserved by explicit id, unchanged name, or a single unambiguous rename; ambiguous renames fail closed. Removing options requires allowRemove:true and reports removed IDs/names.',
  {
    fieldId: z.string().describe('SINGLE_SELECT or MULTI_SELECT field node ID'),
    options: z.array(z.object({
      id: z.string().optional().describe('Existing option ID. Supply this for renamed options when more than one rename/addition is ambiguous.'),
      name: z.string(),
      color: z.enum(['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']).optional().describe('Omit to preserve existing color; new options default GRAY'),
      description: z.string().optional().describe('Omit to preserve existing description; new options default empty'),
    })).min(1).describe('The COMPLETE desired option list'),
    allowRemove: z.boolean().optional().describe('Permit dropping existing options and their item assignments. Default false.'),
  },
  async ({ fieldId, options, allowRemove }) => safe(() => {
    return text(updateSelectFieldOptions(gql, fieldId, options, allowRemove));
  }),
);

'''
    server = replace_between(
        server,
        "server.tool(\n  'gh_project_field_option_update',",
        "server.tool(\n  'gh_project_iteration_configure',",
        option_update,
        'field option update tool',
    )

    iteration_update = r'''server.tool(
  'gh_project_iteration_configure',
  'Configure an ITERATION field using GitHub\'s current schema. startDate/duration default from the first requested iteration for backwards compatibility; existing titles are preserved when omitted and the mutation is round-trip verified.',
  {
    fieldId: z.string().describe('ITERATION field node ID'),
    startDate: z.string().optional().describe('Top-level first iteration start date; defaults to iterations[0].startDate'),
    duration: z.number().int().positive().optional().describe('Top-level cadence in days; defaults to iterations[0].duration'),
    iterations: z.array(z.object({
      startDate: z.string().describe('ISO date YYYY-MM-DD'),
      duration: z.number().int().positive().describe('Length in days'),
      title: z.string().optional().describe('Preserve existing title for matching startDate when omitted'),
    })).min(1),
  },
  async ({ fieldId, startDate, duration, iterations }) => safe(() => {
    return text(configureIterationField(gql, fieldId, { startDate, duration, iterations }));
  }),
);

'''
    server = replace_between(
        server,
        "server.tool(\n  'gh_project_iteration_configure',",
        "server.tool(\n  'gh_project_field_delete',",
        iteration_update,
        'iteration configure tool',
    )

    item_edit = r'''server.tool(
  'gh_project_item_edit',
  'Set or clear one Project item field value. MULTI_SELECT uses values[] of option IDs; other select/iteration values use value with the current option/iteration ID.',
  {
    projectId: z.string().describe('Project node ID (e.g. "PVT_kwHODNwyZM4B...")'),
    itemId: z.string().describe('Project item node ID'),
    fieldId: z.string().describe('Field node ID'),
    valueType: z.enum(['text', 'number', 'date', 'single_select', 'multi_select', 'iteration']).describe('Which kind of value this field holds'),
    value: z.string().optional().describe('Value for text/number/date/single_select/iteration. Omit with clear=true.'),
    values: z.array(z.string()).optional().describe('MULTI_SELECT option IDs. Use clear=true to clear the field.'),
    clear: z.boolean().optional().describe('Clear the field instead of setting a value'),
  },
  async ({ projectId, itemId, fieldId, valueType, value, values, clear }) => safe(() => {
    if (valueType === 'multi_select') {
      return text(updateMultiSelectItemField(gql, { projectId, itemId, fieldId, optionIds: values ?? [], clear: Boolean(clear) }));
    }
    if (values !== undefined) throw new Error('values is only valid when valueType is multi_select.');
    const args = ['project', 'item-edit', '--id', itemId, '--project-id', projectId, '--field-id', fieldId];
    if (clear) {
      args.push('--clear');
    } else {
      if (value === undefined) throw new Error('value is required unless clear=true');
      const flag = { text: '--text', number: '--number', date: '--date', single_select: '--single-select-option-id', iteration: '--iteration-id' }[valueType];
      args.push(flag, value);
    }
    gh(...args);
    return text('Field updated.');
  }),
);

'''
    server = replace_between(
        server,
        "server.tool(\n  'gh_project_item_edit',",
        "server.tool(\n  'gh_project_item_archive',",
        item_edit,
        'item edit tool',
    )

    server_path.write_text(server)

# Modernize the direct-API CLI compatibility layer as well so field reads and fallback calls know MULTI_SELECT.
compat_path = ROOT / 'lib/project-api-compat.mjs'
compat = compat_path.read_text()
if 'options: multiSelectOptions' not in compat:
    compat = replace_once(
        compat,
        '    ... on ProjectV2MultiSelectField { id name dataType options { id name color description } }',
        '    ... on ProjectV2MultiSelectField { id name dataType options: multiSelectOptions { id name color description } }',
        'multi-select field selection',
    )

old_field_start = '  fieldCreate(owner, number, name, dataType, optionNames = []) {'
if old_field_start in compat:
    new_field_method = r'''  fieldCreate(owner, number, name, dataType, optionNames = [], iterationConfiguration = null) {
    const q = `mutation($input:CreateProjectV2FieldInput!){createProjectV2Field(input:$input){projectV2Field{${projectFieldsSelection()}}}}`;
    const input = { projectId: this.projectId(owner, number), name, dataType };
    if (dataType === 'SINGLE_SELECT' || dataType === 'MULTI_SELECT') {
      if (!optionNames.length) throw new Error(`options are required when dataType is ${dataType}.`);
      const key = dataType === 'MULTI_SELECT' ? 'multiSelectOptions' : 'singleSelectOptions';
      input[key] = optionNames.map((optionName) => ({ name: optionName, color: 'GRAY', description: '' }));
    }
    if (dataType === 'ITERATION') {
      if (!iterationConfiguration) throw new Error('iterationConfiguration is required when dataType is ITERATION.');
      input.iterationConfiguration = iterationConfiguration;
    }
    return this.backend.graphql(q, { input }).data.createProjectV2Field.projectV2Field;
  }

'''
    compat = replace_between(compat, old_field_start, '  fieldDelete(fieldId) {', new_field_method, 'compat field create')

compat = replace_once(
    compat,
    "    else if (flagValue(args, '--iteration-id') !== undefined) value.iterationId = flagValue(args, '--iteration-id');\n    else throw new Error('No supported project item field value flag was supplied.');",
    "    else if (flagValue(args, '--iteration-id') !== undefined) value.iterationId = flagValue(args, '--iteration-id');\n"
    "    else if (flagValue(args, '--multi-select-option-ids') !== undefined) value.multiSelectOptionIds = flagValue(args, '--multi-select-option-ids').split(',').filter(Boolean);\n"
    "    else throw new Error('No supported project item field value flag was supplied.');",
    'compat multi-select item value',
)

old_handle_start = "    if (command === 'field-create') {"
if old_handle_start in compat and '--iteration-configuration-json' not in compat:
    new_handle = r'''    if (command === 'field-create') {
      const dataType = flagValue(args, '--data-type');
      const optionFlag = dataType === 'MULTI_SELECT' ? '--multi-select-options' : '--single-select-options';
      const optionNames = (flagValue(args, optionFlag) ?? '').split(',').filter(Boolean);
      const iterationRaw = flagValue(args, '--iteration-configuration-json');
      const iterationConfiguration = iterationRaw ? JSON.parse(iterationRaw) : null;
      return result(this.fieldCreate(
        flagValue(args, '--owner'), Number(args[2]), flagValue(args, '--name'), dataType, optionNames, iterationConfiguration,
      ));
    }
'''
    compat = replace_between(compat, old_handle_start, "    if (command === 'field-delete') {", new_handle, 'compat field-create handle')

compat_path.write_text(compat)

# Update the canonical client-neutral skill so Claude and Codex receive the new field semantics together.
skill_path = ROOT / 'skills/gh-project-manage/SKILL.md'
skill = skill_path.read_text()
skill = skill.replace('version: 1.4.0', 'version: 1.5.0', 1)
skill = skill.replace(
    '| Change single-select options | `gh_project_field_option_update` — send the complete desired option set and respect removal guard |',
    '| Change single/multi-select options | `gh_project_field_option_update` — send the complete desired option set; preserve IDs and respect the removal guard |',
)
skill = skill.replace(
    '| Edit/clear item field | `gh_project_item_edit` |',
    '| Edit/clear item field | `gh_project_item_edit` — MULTI_SELECT uses option-ID arrays |',
)
skill = skill.replace(
    '- `gh_project_item_edit` needs the project node ID, item ID, and field ID. Single-select/iteration values use option/iteration IDs, not display labels.',
    '- `gh_project_item_edit` needs the project node ID, item ID, and field ID. Single-select/iteration values use option/iteration IDs; MULTI_SELECT uses an array of option IDs, never display labels.',
)
skill = skill.replace(
    '- `gh_project_field_option_update` replaces the option collection. Preserve existing option identities when the tool/schema supports it and never remove options accidentally.',
    '- `gh_project_field_option_update` replaces the option collection but now preserves existing option IDs automatically for unchanged names and unambiguous renames. Supply explicit IDs for ambiguous renames; removing options requires `allowRemove:true` and reports removed IDs/names.',
)
skill_path.write_text(skill)

# Bump all client/server package manifests together; contract:write will update contracts/tools.json afterward.
for relative in ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']:
    path = ROOT / relative
    data = json.loads(path.read_text())
    data['version'] = '1.5.0'
    path.write_text(json.dumps(data, indent=2) + '\n')

print('field modernization bootstrap applied')
