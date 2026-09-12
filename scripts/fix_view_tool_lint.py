from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'lib/tools-views-graphql.mjs'
text = path.read_text()
old = '''      let view = current;\n      if (hasApiEdit) {\n        view = api.updateView(owner, number, {'''
new = '''      if (hasApiEdit) {\n        api.updateView(owner, number, {'''
if text.count(old) != 1:
    raise RuntimeError(f'expected one view edit assignment, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
print('view tool lint fix applied')
