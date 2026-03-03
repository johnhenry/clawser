import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['web/test/**/*.vitest.{js,mjs}'],
    setupFiles: ['web/test/_setup-vitest.mjs'],
    environment: 'node',
    testTimeout: 10000,
  },
});
