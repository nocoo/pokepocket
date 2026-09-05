import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LOCAL_DEVELOPMENT__: false },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
