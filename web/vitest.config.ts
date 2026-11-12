import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: vitest bundles its own Vite version. Logic tests need no plugins.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
