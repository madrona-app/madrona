import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import noGenericTailwindColors from './eslint-rules/no-generic-tailwind-colors.js'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'jsx-a11y': jsxA11y,
      'madrona': { rules: { 'no-generic-tailwind-colors': noGenericTailwindColors } },
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Accessibility rules - catch issues at development time
      // Set as warnings initially to allow gradual fixes without blocking builds
      ...Object.fromEntries(
        Object.entries(jsxA11y.configs.recommended.rules).map(([key, value]) => [key, 'warn'])
      ),
      // Disable deprecated label-has-for rule (replaced by label-has-associated-control)
      'jsx-a11y/label-has-for': 'off',
      // Allow unused vars/args with underscore prefix (common convention)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Downgrade explicit any to warning - there are many instances that need gradual fixing
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow exporting hooks alongside components (common pattern for contexts)
      'react-refresh/only-export-components': ['warn', {
        allowExportNames: ['useAuth', 'useTheme', 'useOrganization', 'getStatusLabel', 'getStatusDotColor', 'getRunStatusBgColor', 'getRunStatusTextColor'],
        allowConstantExport: true,
      }],
      // Downgrade preserve-manual-memoization - complex ReactFlow patterns trigger false positives
      'react-hooks/preserve-manual-memoization': 'warn',
      // React Compiler-style rules — valuable signal but opinionated about patterns
      // (form-reset-on-open useEffects, ref access in render, Date.now()/Math.random()
      // in a map callback, dynamic icon lookup). Fix gradually; don't block CI.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      // Prevent direct console.* usage — use logger from @/lib/logger instead
      'no-console': 'error',
      // Prevent generic Tailwind colors — use Madrona palette instead
      'madrona/no-generic-tailwind-colors': 'error',
    },
  },
  // Test files reference class names inside querySelector strings (e.g. '.bg-black')
  // to assert on rendered markup — those aren't styling decisions.
  {
    files: ['**/test/**', '**/tests/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: { 'madrona/no-generic-tailwind-colors': 'off' },
  },
  // Allow console.* in logger.ts (the one file that wraps console calls)
  {
    files: ['**/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  // Allow console.* in mapping-engine (standalone demo/engine code)
  {
    files: ['**/mapping-engine/**'],
    rules: { 'no-console': 'off' },
  },
  // Allow console.* in projectionResolver (low-level utility)
  {
    files: ['**/lib/projectionResolver.ts'],
    rules: { 'no-console': 'off' },
  },
  // Allow console.* in test files (mocking, assertions, setup)
  {
    files: ['**/test/**', '**/tests/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
])
