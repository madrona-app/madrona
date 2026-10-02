import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // jsdom defaults to about:blank, which is an *opaque origin* — and
    // localStorage/sessionStorage throw SecurityError on opaque origins
    // (jsdom Window.js: "localStorage is not available for opaque
    // origins"). Any component reading localStorage during render then
    // blows up in tests while working fine in the browser. Give jsdom a
    // real origin so web storage exists.
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000' },
    },
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/test/**/*',
        'src/types/**/*',
      ],
      // Coverage RATCHET (re-enabled 2026-06-07). Rather than the old
      // all-or-nothing 80% gate (which was disabled because it forced a
      // test for every product change), these floors sit a few points
      // below current actuals: they can't block normal work, but they
      // fail CI the moment coverage drops meaningfully — so the suite
      // can only climb. Raise these as the coverage ladder progresses;
      // 80% remains the eventual target.
      //
      // Measured actuals 2026-06-07 (v8): 45.72 stmts / 43.01 branches
      // / 33.89 funcs / 46.95 lines. (Up from 2026-04-30's 43.73 /
      // 42.86 / 33.67 / 44.81.) Floors set ~2-3pts under each.
      thresholds: {
        statements: 43,
        lines: 44,
        branches: 40,
        functions: 31,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
