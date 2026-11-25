import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __LOCAL_DEVELOPMENT__: false },
  test: {
    allowOnly: false,
    passWithNoTests: false,
    include: ['tests/unit/**/*.test.{ts,tsx,mjs}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/lib/**/*.ts', 'worker/**/*.ts'],
      exclude: [
        'src/vite-env.d.ts',
        'worker-configuration.d.ts',
        '**/*.d.ts',
        // Pure React View shells — covered by browser flows
        'src/components/**',
        'src/App.tsx',
        'src/main.tsx',
        // Non-runtime tooling scripts
        'scripts/**',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
