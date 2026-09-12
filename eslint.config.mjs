import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.gh-views-debug/'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Empty catch blocks are used deliberately as best-effort fallbacks.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // tools-views.mjs runs callbacks inside page.evaluate() in the browser
    // context, where `document`/`window` are the page's globals.
    files: ['lib/tools-views.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
