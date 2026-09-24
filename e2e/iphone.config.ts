import { defineConfig, devices } from '@playwright/test';

// Build first: npm run build -w apps/web
export default defineConfig({
  testDir: '.',
  testMatch: 'iphone.spec.ts',
  timeout: 45_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run preview -w apps/web -- --host 127.0.0.1 --port 4173', cwd: '..', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], browserName: 'chromium', channel: 'chromium' } },
  ],
});
