// playwright.config.js — CI test runner for Clawser browser test suite
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
  },
  webServer: {
    command: 'npx serve web -l 8080',
    port: 8080,
    reuseExistingServer: true,
  },
});
