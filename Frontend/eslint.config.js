import js from '@eslint/js';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', '*.log'] },
  js.configs.recommended,
  {
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        browser: true,
        es2024: true,
        fetch: 'readonly',
        FormData: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-useless-assignment': 'error',
    },
  },
  {
    files: ['**/*.test.jsx', '**/*.test.js', '**/*.spec.jsx', '**/*.spec.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        render: 'readonly',
        screen: 'readonly',
        fireEvent: 'readonly',
      },
    },
  },
];