import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic only (no Worker bindings); flows are Playwright's job.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
