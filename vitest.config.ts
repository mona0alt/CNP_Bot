import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'setup/**/*.test.ts', 'skills-engine/**/*.test.ts'],
    env: {
      // Provide a stable test-only secret so config.ts doesn't call process.exit
      JWT_SECRET: 'test-secret-do-not-use-in-production',
    },
  },
});
