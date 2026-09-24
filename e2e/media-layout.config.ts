import { defineConfig, devices } from '@playwright/test';

// Standalone CSS regression checks: no emulators or live business data required.
export default defineConfig({
  testDir: '.',
  testMatch: 'media-layout.spec.ts',
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
  ],
});
