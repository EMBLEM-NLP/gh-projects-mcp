from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parent.parent
bootstrap_path = ROOT / 'scripts/bootstrap_view_graphql.py'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def remove_replace_block(script: str, label: str, assignment_prefix: str) -> str:
    marker = f"'{label}'"
    marker_index = script.index(marker)
    start = script.rfind(assignment_prefix, 0, marker_index)
    if start < 0:
        raise RuntimeError(f'{label}: replacement block start not found')
    end = script.index('\n)\n', marker_index) + len('\n)\n')
    return script[:start] + script[end:]


# Patch the live source using line-exact text before the larger guarded bootstrap.
server_path = ROOT / 'server.mjs'
server = server_path.read_text()
server = replace_once(
    server,
    '''      const q = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${number}) { createdAt updatedAt views(first: 20) { nodes { name number createdAt layout } } } } }`;\n      const vr = gql(q);\n      views = vr.data[root]?.projectV2?.views?.nodes ?? [];''',
    '''      const q = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${number}) { createdAt updatedAt views(first: 100) { nodes { ${VIEW_SELECTION} } } } } }`;\n      const vr = gql(q);\n      views = (vr.data[root]?.projectV2?.views?.nodes ?? []).map(normalizeView);''',
    'project view enriched query',
)
server_path.write_text(server)

view_api_path = ROOT / 'lib/view-api.mjs'
view_api = view_api_path.read_text()
view_api = replace_once(
    view_api,
    '''    const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);''',
    '''    const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);\n    if (graphLayout === 'ROADMAP_LAYOUT' && visibleFieldIds !== undefined) {\n      throw new Error('visibleFieldIds is not applicable to roadmap views.');\n    }''',
    'roadmap create validation',
)
view_api = replace_once(
    view_api,
    '''    const { view: current } = findView(owner, number, { viewId, viewName });\n    const parts = [`viewId: "${gqlStr(current.id)}"`];''',
    '''    const { view: current } = findView(owner, number, { viewId, viewName });\n    const targetLayout = layout === undefined ? current.layout : VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (targetLayout === 'ROADMAP_LAYOUT' && visibleFieldIds !== undefined) {\n      throw new Error('visibleFieldIds is not applicable to roadmap views.');\n    }\n    const parts = [`viewId: "${gqlStr(current.id)}"`];''',
    'roadmap update validation',
)
view_api_path.write_text(view_api)

# Remove the three already-applied blocks from the staged bootstrap, then execute the remainder.
script = bootstrap_path.read_text()
script = remove_replace_block(script, 'project view enriched query', 'server = replace_once(')
script = remove_replace_block(script, 'roadmap create validation', 'view_api = replace_once(')
script = remove_replace_block(script, 'roadmap update validation', 'view_api = replace_once(')
bootstrap_path.write_text(script)
runpy.run_path(str(bootstrap_path), run_name='__main__')
