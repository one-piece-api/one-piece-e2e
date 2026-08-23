import { expect, Page, test } from '@playwright/test';

// Credentials for users seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json - see
// admin-user-list.spec.ts for the full seeded-user rationale.
const ADMIN = { username: 'luffy', password: 'luffy-change-me' };

async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto('/');
  await page.locator('#username').fill(credentials.username);
  await page.locator('#password').fill(credentials.password);
  await page.locator('#kc-login').click();
}

// Unique per test run so re-running this suite against the same cluster
// (e.g. locally, without recreating it) never collides with a PENDING
// account a previous run already created - see
// docs/adr/0001-e2e-environment-strategy.md ("isolation via unique data, not
// infrastructure reset").
function uniqueEmail(handle: string): string {
  return `${handle}-${Date.now()}@onepiece.local`;
}

test('an admin invites a new crewmate and sees them appear as pending', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();

  const email = uniqueEmail('robin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('checkbox', { name: 'EDITOR' }).check();
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(new RegExp(`Invitation sent to ${email}`))).toBeVisible();

  const row = page.locator('table tbody tr').filter({ hasText: email });
  await expect(row.getByText('Pending')).toBeVisible();
  await expect(row.getByText('EDITOR', { exact: true })).toBeVisible();
});

test('inviting an already-registered email is rejected', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();

  // luffy@onepiece.local is the seeded bootstrap admin - always registered.
  await page.getByLabel('Email').fill('luffy@onepiece.local');
  await page.getByRole('checkbox', { name: 'ADMIN' }).check();
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(/already registered/)).toBeVisible();
});
