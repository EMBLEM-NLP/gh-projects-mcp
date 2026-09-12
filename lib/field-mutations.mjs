import { gqlStr } from './helpers.mjs';

// GitHub accepts these colors for both single-select and multi-select options.
export const PROJECT_OPTION_COLORS = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];

// Turn one option into the GraphQL input literal used by create/updateProjectV2Field.
function optionLiteral(option) {
  const parts = [];
  if (option.id) parts.push(`id: "${gqlStr(option.id)}"`);
  parts.push(`name: "${gqlStr(option.name)}"`);
  parts.push(`color: ${option.color ?? 'GRAY'}`);
  parts.push(`description: "${gqlStr(option.description ?? '')}"`);
  return `{${parts.join(', ')}}`;
}

// Return an option with existing identity and metadata preserved unless explicitly changed.
function mergeOption(current, desired) {
  return {
    ...(current?.id ? { id: current.id } : {}),
    name: desired.name,
    color: desired.color ?? current?.color ?? 'GRAY',
    description: desired.description ?? current?.description ?? '',
  };
}

/**
 * Reconcile a complete desired option set against the field's current options.
 *
 * Identity rules are deliberately conservative:
 * - explicit desired `id` wins;
 * - otherwise an unchanged name preserves the matching current id;
 * - one unmatched current + one unmatched desired is treated as an unambiguous rename;
 * - multiple unmatched options are ambiguous and require explicit ids instead of guessing.
 *
 * @param {Array<{id:string,name:string,color?:string,description?:string}>} currentOptions
 * @param {Array<{id?:string,name:string,color?:string,description?:string}>} desiredOptions
 * @param {boolean} allowRemove
 * @returns {{options:Array<object>, removed:Array<object>}}
 */
export function reconcileFieldOptions(currentOptions, desiredOptions, allowRemove = false) {
  const current = currentOptions ?? [];
  const desired = desiredOptions ?? [];
  const currentById = new Map(current.map((option) => [option.id, option]));
  const currentByName = new Map(current.map((option) => [option.name, option]));
  const usedIds = new Set();
  const desiredNames = new Set();
  const resolved = new Array(desired.length);
  const unresolvedIndexes = [];

  for (let index = 0; index < desired.length; index += 1) {
    const option = desired[index];
    if (desiredNames.has(option.name)) throw new Error(`Duplicate desired option name: ${option.name}.`);
    desiredNames.add(option.name);

    if (option.id) {
      const existing = currentById.get(option.id);
      if (!existing) throw new Error(`Option id ${option.id} does not belong to this field.`);
      if (usedIds.has(existing.id)) throw new Error(`Option id ${existing.id} was supplied more than once.`);
      usedIds.add(existing.id);
      resolved[index] = mergeOption(existing, option);
      continue;
    }

    const sameName = currentByName.get(option.name);
    if (sameName && !usedIds.has(sameName.id)) {
      usedIds.add(sameName.id);
      resolved[index] = mergeOption(sameName, option);
      continue;
    }

    unresolvedIndexes.push(index);
  }

  let remainingCurrent = current.filter((option) => !usedIds.has(option.id));

  // A single one-for-one mismatch is the only rename we can infer without risking identity loss.
  if (unresolvedIndexes.length === 1 && remainingCurrent.length === 1) {
    const index = unresolvedIndexes.shift();
    const existing = remainingCurrent[0];
    usedIds.add(existing.id);
    resolved[index] = mergeOption(existing, desired[index]);
    remainingCurrent = [];
  }

  // If existing and desired options are both still unmatched, the caller must identify renames by id.
  if (unresolvedIndexes.length && remainingCurrent.length) {
    const currentSummary = remainingCurrent.map((option) => `${option.id}:${option.name}`).join(', ');
    const desiredSummary = unresolvedIndexes.map((index) => desired[index].name).join(', ');
    throw new Error(
      `Ambiguous option rename/addition. Unmatched current options: ${currentSummary}. ` +
      `Unmatched desired options: ${desiredSummary}. Supply existing option ids for renamed options, ` +
      `or split removals and additions into separate calls.`,
    );
  }

  // Anything unresolved after all current options were matched is a genuinely new option.
  for (const index of unresolvedIndexes) resolved[index] = mergeOption(null, desired[index]);

  const removed = current.filter((option) => !usedIds.has(option.id));
  if (removed.length && !allowRemove) {
    const summary = removed.map((option) => `${option.id}:${option.name}`).join(', ');
    throw new Error(
      `This would DELETE options and clear their item assignments: ${summary}. ` +
      `Include them in the desired set, or pass allowRemove:true to confirm deletion.`,
    );
  }

  return { options: resolved, removed };
}

// Fetch one single- or multi-select field and normalize its options to `options`.
function readSelectField(gql, fieldId) {
  const query = `{ node(id: "${gqlStr(fieldId)}") {
    __typename
    ... on ProjectV2SingleSelectField { id name options { id name color description } }
    ... on ProjectV2MultiSelectField { id name options: multiSelectOptions { id name color description } }
  } }`;
  const node = gql(query).data?.node;
  if (!node || !['ProjectV2SingleSelectField', 'ProjectV2MultiSelectField'].includes(node.__typename)) {
    throw new Error('fieldId did not resolve to a SINGLE_SELECT or MULTI_SELECT Project field.');
  }
  return node;
}

/** Safely replace single- or multi-select options while preserving existing option identities. */
export function updateSelectFieldOptions(gql, fieldId, desiredOptions, allowRemove = false) {
  const current = readSelectField(gql, fieldId);
  const reconciled = reconcileFieldOptions(current.options ?? [], desiredOptions, allowRemove);
  const inputKey = current.__typename === 'ProjectV2MultiSelectField' ? 'multiSelectOptions' : 'singleSelectOptions';
  const fragment = current.__typename === 'ProjectV2MultiSelectField'
    ? '... on ProjectV2MultiSelectField { id name options: multiSelectOptions { id name color description } }'
    : '... on ProjectV2SingleSelectField { id name options { id name color description } }';
  const list = reconciled.options.map(optionLiteral).join(', ');
  const mutation = `mutation { updateProjectV2Field(input: {
    fieldId: "${gqlStr(fieldId)}",
    ${inputKey}: [${list}]
  }) { projectV2Field { __typename ${fragment} } } }`;
  const field = gql(mutation).data?.updateProjectV2Field?.projectV2Field;
  if (!field) throw new Error('updateProjectV2Field returned no field.');

  const returnedIds = new Set((field.options ?? []).map((option) => option.id));
  const expectedPreservedIds = reconciled.options.filter((option) => option.id).map((option) => option.id);
  const lostIds = expectedPreservedIds.filter((id) => !returnedIds.has(id));
  if (lostIds.length) throw new Error(`Option identity verification failed; GitHub did not preserve ids: ${lostIds.join(', ')}.`);

  return { field, removed: reconciled.removed };
}

// Normalize iteration input to the current GitHub schema while preserving known existing titles.
export function normalizeIterationConfiguration(currentConfiguration, requested) {
  const requestedIterations = requested.iterations ?? [];
  if (!requestedIterations.length) throw new Error('At least one iteration is required.');

  const currentByStart = new Map((currentConfiguration?.iterations ?? []).map((iteration) => [iteration.startDate, iteration]));
  const startDate = requested.startDate ?? requestedIterations[0].startDate;
  const duration = requested.duration ?? requestedIterations[0].duration;
  if (!startDate) throw new Error('iteration startDate is required.');
  if (!Number.isInteger(duration) || duration <= 0) throw new Error('iteration duration must be a positive integer number of days.');

  const iterations = requestedIterations.map((iteration, index) => {
    if (!iteration.startDate) throw new Error(`iterations[${index}].startDate is required.`);
    if (!Number.isInteger(iteration.duration) || iteration.duration <= 0) {
      throw new Error(`iterations[${index}].duration must be a positive integer.`);
    }
    return {
      startDate: iteration.startDate,
      duration: iteration.duration,
      title: iteration.title ?? currentByStart.get(iteration.startDate)?.title ?? `Iteration ${index + 1}`,
    };
  });

  return { startDate, duration, iterations };
}

// Convert a normalized iteration configuration to GitHub's GraphQL input literal.
function iterationConfigurationLiteral(configuration) {
  const iterations = configuration.iterations.map((iteration) =>
    `{title: "${gqlStr(iteration.title)}", startDate: "${gqlStr(iteration.startDate)}", duration: ${iteration.duration}}`
  ).join(', ');
  return `{startDate: "${gqlStr(configuration.startDate)}", duration: ${configuration.duration}, iterations: [${iterations}]}`;
}

/** Configure an iteration field with the current required top-level input shape and round-trip verification. */
export function configureIterationField(gql, fieldId, requested) {
  const currentQuery = `{ node(id: "${gqlStr(fieldId)}") {
    ... on ProjectV2IterationField { id name configuration { duration iterations { id title startDate duration } } }
  } }`;
  const current = gql(currentQuery).data?.node;
  if (!current?.id) throw new Error('fieldId did not resolve to a ProjectV2IterationField.');

  const configuration = normalizeIterationConfiguration(current.configuration, requested);
  const literal = iterationConfigurationLiteral(configuration);
  const mutation = `mutation { updateProjectV2Field(input: {
    fieldId: "${gqlStr(fieldId)}",
    iterationConfiguration: ${literal}
  }) { projectV2Field { ... on ProjectV2IterationField {
    id name configuration { duration iterations { id title startDate duration } }
  } } } }`;
  const field = gql(mutation).data?.updateProjectV2Field?.projectV2Field;
  if (!field?.configuration) throw new Error('updateProjectV2Field returned no iteration configuration.');

  const actual = field.configuration;
  if (actual.duration !== configuration.duration) {
    throw new Error(`Iteration verification failed: expected cadence ${configuration.duration} days, got ${actual.duration}.`);
  }
  for (const expected of configuration.iterations) {
    const matched = (actual.iterations ?? []).find((iteration) => iteration.startDate === expected.startDate);
    if (!matched || matched.duration !== expected.duration || matched.title !== expected.title) {
      throw new Error(`Iteration verification failed for ${expected.startDate} (${expected.title}).`);
    }
  }

  return field;
}

/** Create any currently supported custom Project field directly through GraphQL. */
export function createProjectField(gql, ownerRoot, { owner, number, name, dataType, options = [], iterationConfiguration }) {
  const root = ownerRoot(owner);
  const projectQuery = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${Number(number)}) { id } } }`;
  const projectId = gql(projectQuery).data?.[root]?.projectV2?.id;
  if (!projectId) throw new Error(`Could not resolve project #${number} for ${owner}.`);

  const inputParts = [
    `projectId: "${gqlStr(projectId)}"`,
    `name: "${gqlStr(name)}"`,
    `dataType: ${dataType}`,
  ];

  if (dataType === 'SINGLE_SELECT' || dataType === 'MULTI_SELECT') {
    if (!options.length) throw new Error(`options is required when dataType is ${dataType}.`);
    const key = dataType === 'MULTI_SELECT' ? 'multiSelectOptions' : 'singleSelectOptions';
    const literals = options.map((option) => optionLiteral(
      typeof option === 'string' ? { name: option, color: 'GRAY', description: '' } : option
    ));
    inputParts.push(`${key}: [${literals.join(', ')}]`);
  }

  if (dataType === 'ITERATION') {
    if (!iterationConfiguration) throw new Error('iterationConfiguration is required when dataType is ITERATION.');
    const normalized = normalizeIterationConfiguration(null, iterationConfiguration);
    inputParts.push(`iterationConfiguration: ${iterationConfigurationLiteral(normalized)}`);
  }

  const fieldSelection = `
    __typename
    ... on ProjectV2Field { id name dataType }
    ... on ProjectV2SingleSelectField { id name dataType options { id name color description } }
    ... on ProjectV2MultiSelectField { id name dataType options: multiSelectOptions { id name color description } }
    ... on ProjectV2IterationField { id name dataType configuration { duration iterations { id title startDate duration } } }
  `;
  const mutation = `mutation { createProjectV2Field(input: {${inputParts.join(', ')}}) { projectV2Field {${fieldSelection}} } }`;
  const field = gql(mutation).data?.createProjectV2Field?.projectV2Field;
  if (!field?.id) throw new Error('createProjectV2Field returned no field.');
  return field;
}

/** Set or clear a MULTI_SELECT field value directly through GraphQL. */
export function updateMultiSelectItemField(gql, { projectId, itemId, fieldId, optionIds = [], clear = false }) {
  if (clear) {
    const mutation = `mutation { clearProjectV2ItemFieldValue(input: {
      projectId: "${gqlStr(projectId)}", itemId: "${gqlStr(itemId)}", fieldId: "${gqlStr(fieldId)}"
    }) { projectV2Item { id } } }`;
    const item = gql(mutation).data?.clearProjectV2ItemFieldValue?.projectV2Item;
    if (!item?.id) throw new Error('clearProjectV2ItemFieldValue returned no item.');
    return item;
  }

  if (!optionIds.length) throw new Error('values must contain at least one multi-select option id unless clear=true.');
  const ids = optionIds.map((id) => `"${gqlStr(id)}"`).join(', ');
  const mutation = `mutation { updateProjectV2ItemFieldValue(input: {
    projectId: "${gqlStr(projectId)}", itemId: "${gqlStr(itemId)}", fieldId: "${gqlStr(fieldId)}",
    value: { multiSelectOptionIds: [${ids}] }
  }) { projectV2Item { id } } }`;
  const item = gql(mutation).data?.updateProjectV2ItemFieldValue?.projectV2Item;
  if (!item?.id) throw new Error('updateProjectV2ItemFieldValue returned no item.');
  return item;
}
