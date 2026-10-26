import { defineConfig } from 'vitest/config';

const threshold = { lines: 80, functions: 80, branches: 80, statements: 80 };

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/panel/**', 'src/background/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // NFR-13: at least 80% for the link parser, extractors and verdict engine.
      thresholds: {
        'src/links/**': threshold,
        'src/extract/**': threshold,
        'src/verdict/**': threshold,
      },
    },
  },
});
