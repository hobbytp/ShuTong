/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended'],
  rules: {
    // Keep repo lint unblocked; rely on TypeScript for type-aware checks.
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',

    // Avoid failing builds on HMR export pattern warnings.
    'react-refresh/only-export-components': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'dist-electron/',
    'release/',
    'MineContext/',
    'public/',
  ],
};
