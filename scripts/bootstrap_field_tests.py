from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
path = ROOT / 'test/project-api-compat.test.mjs'
text = path.read_text()
old = """test('iteration field creation fails closed pending #57', () => {\n  const compat = new ProjectApiCompat(backendStub());\n  assert.throws(\n    () => compat.handle(['project', 'field-create', '1', '--owner', 'o', '--name', 'Sprint', '--data-type', 'ITERATION']),\n    /#57/,\n  );\n});\n"""
new = """test('iteration field creation forwards the current iteration configuration', () => {\n  const backend = backendStub([{\n    data: { createProjectV2Field: { projectV2Field: { id: 'ITER', name: 'Sprint', dataType: 'ITERATION' } } },\n  }]);\n  const compat = new ProjectApiCompat(backend);\n  const config = {\n    startDate: '2026-09-14', duration: 14,\n    iterations: [{ title: 'Sprint 1', startDate: '2026-09-14', duration: 14 }],\n  };\n  const out = JSON.parse(compat.handle([\n    'project', 'field-create', '1', '--owner', 'o', '--name', 'Sprint', '--data-type', 'ITERATION',\n    '--iteration-configuration-json', JSON.stringify(config),\n  ]).stdout);\n  assert.equal(out.id, 'ITER');\n  assert.deepEqual(backend.calls[0].variables.input.iterationConfiguration, config);\n});\n"""
if old not in text:
    raise RuntimeError('old iteration compatibility test marker not found')
path.write_text(text.replace(old, new, 1))
print('field compatibility test migration applied')
