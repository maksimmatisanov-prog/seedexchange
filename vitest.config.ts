import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    isolate: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
