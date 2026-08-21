import { defineConfig } from '@playwright/test';

// No webServer block: unlike a single-app Playwright setup, the environment
// this suite runs against (Keycloak + oauth2-proxy + user-service +
// user-frontend, wired together as they would be in a real deployment) is
// provisioned externally by onepiece-infrastructure's scripts/setup.sh, not
// by this repo. See docs/adr/0001-e2e-environment-strategy.md.
export default defineConfig({
  testDir: './tests',
  // Tests share one cluster for the whole run (recreating it per test would
  // cost minutes each time), so they must not race each other over shared
  // state (e.g. the same Keycloak session).
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4180',
    trace: 'on-first-retry',
  },
});
