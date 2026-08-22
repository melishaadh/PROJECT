// @ts-check
/**
 * Flat config for the API service.
 *
 * Deliberately type-*un*aware (`tseslint.configs.recommended`, not
 * `recommendedTypeChecked`): the type-checked rules would need a second full
 * program build on every lint run, and `npm run typecheck` already covers the
 * project with the real compiler.
 */

const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        module: 'writable',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
      },
    },
    rules: {
      /**
       * Nest leans on decorator metadata and Mongoose documents are loosely
       * typed at the boundary, so a blanket ban on `any` would be noise rather
       * than signal. Flagged as a warning so it stays visible without failing
       * the build.
       */
      '@typescript-eslint/no-explicit-any': 'warn',
      // `catch {}` around a best-effort cache write is intentional throughout.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }
);
