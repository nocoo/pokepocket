import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LOCAL_DEVELOPMENT__: false },
  test: {
    include: ['tests/unit/**/*.test.{ts,mjs}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.{ts,tsx}',
        'worker/**/*.ts',
        'scripts/**/*.{ts,mjs}',
      ],
      exclude: [
        'src/vite-env.d.ts',
        'worker-configuration.d.ts',
        '**/*.d.ts',
      ],
    },
  },
});
