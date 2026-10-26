// Lint rules that enforce parts of the spec in code review:
//   NFR-07 / NFR-12  fetch and chrome.cookies only inside src/upwork (plus src/store/supabase.ts, D-32)
//   FR-24            confidence is only set inside src/verdict
//   NFR-10           no innerHTML / dangerouslySetInnerHTML anywhere
//   NFR-08           no console output except through src/core/log.ts (which redacts)

import tseslint from 'typescript-eslint';

const htmlInjection = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'NFR-10: render Upwork data as text, never as HTML.' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'NFR-10: render Upwork data as text, never as HTML.' },
];
const confidenceOutsideVerdict = [
  { selector: "ObjectExpression > Property[key.name='confidence']", message: 'FR-24: only src/verdict may set confidence.' },
  { selector: "AssignmentExpression > MemberExpression.left[property.name='confidence']", message: 'FR-24: only src/verdict may set confidence.' },
];
const htmlProperties = [
  { property: 'innerHTML', message: 'NFR-10: use textContent or Preact rendering.' },
  { property: 'outerHTML', message: 'NFR-10: use textContent or Preact rendering.' },
];
const cookies = { object: 'chrome', property: 'cookies', message: 'NFR-12: only src/upwork reads Upwork cookies.' };
const fetchGlobal = { name: 'fetch', message: 'NFR-07 / NFR-12: only src/upwork may call fetch.' };

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'phase0/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': ['error', fetchGlobal],
      'no-restricted-properties': ['error', cookies, ...htmlProperties],
      'no-restricted-syntax': ['error', ...htmlInjection, ...confidenceOutsideVerdict],
    },
  },
  {
    files: ['src/upwork/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': ['error', ...htmlProperties],
    },
  },
  {
    // D-32: the only fetch outside src/upwork, to the user's own Supabase project.
    files: ['src/store/supabase.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // D-32: copies the stored confidence to and from the database; it never decides one (FR-24).
    files: ['src/store/checks.ts'],
    rules: { 'no-restricted-syntax': ['error', ...htmlInjection] },
  },
  {
    files: ['src/verdict/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...htmlInjection] },
  },
  {
    files: ['src/core/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off', 'no-restricted-properties': 'off', 'no-console': 'off' },
  },
);
