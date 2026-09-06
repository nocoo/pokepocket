import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LOCAL_DEVELOPMENT__: false },
  test: {
    include: ['tests/l2/**/*.test.{ts,mjs}'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
