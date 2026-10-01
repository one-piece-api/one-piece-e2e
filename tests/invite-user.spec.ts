import { expect, Page, test } from '@playwright/test';
import { cardStatus, crewCard, pickRole } from './support/crew-manifest';

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
  await page.getByRole('button', { name: 'New User' }).click();

  const email = uniqueEmail('robin');
  await page.getByLabel('Email').fill(email);
  await pickRole(page, 'EDITOR');
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(new RegExp(`Invitation sent to ${email}`))).toBeVisible();

  const row = crewCard(page, email);
  await expect(cardStatus(row, 'Pending')).toBeVisible();
  await expect(row.getByText('EDITOR', { exact: true })).toBeVisible();
});

test('inviting an already-registered email is rejected', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();
  await page.getByRole('button', { name: 'New User' }).click();

  // luffy@onepiece.local is the seeded bootstrap admin - always registered.
  await page.getByLabel('Email').fill('luffy@onepiece.local');
  await pickRole(page, 'ADMIN');
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(/already registered/)).toBeVisible();
});

test('an admin invites a crewmate with more than one role', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();
  await page.getByRole('button', { name: 'New User' }).click();

  const email = uniqueEmail('franky');
  await page.getByLabel('Email').fill(email);
  await pickRole(page, 'ADMIN');
  await pickRole(page, 'REVIEWER');
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(new RegExp(`Invitation sent to ${email}`))).toBeVisible();

  const row = crewCard(page, email);
  await expect(cardStatus(row, 'Pending')).toBeVisible();
  await expect(row.getByText('ADMIN', { exact: true })).toBeVisible();
  await expect(row.getByText('REVIEWER', { exact: true })).toBeVisible();
  // Only the two checked roles - not every role in the form.
  await expect(row.getByText('EDITOR', { exact: true })).toHaveCount(0);
});

test('the invite form rejects an empty email and no role without calling the backend', async ({
  page,
}) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();
  await page.getByRole('button', { name: 'New User' }).click();

  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(/email address be needed/)).toBeVisible();
  await expect(page.getByText(/Pick at least one role/)).toBeVisible();
  await expect(page.getByText(/Invitation sent/)).toHaveCount(0);
});

test('the invite form rejects a malformed email address', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();
  await page.getByRole('button', { name: 'New User' }).click();

  await page.getByLabel('Email').fill('not-an-email');
  await pickRole(page, 'EDITOR');
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  await expect(page.getByText(/no proper email address/)).toBeVisible();
  await expect(page.getByText(/Invitation sent/)).toHaveCount(0);
});

test('a non-admin cannot invite a new crewmate', async ({ page }) => {
  await login(page, { username: 'nami', password: 'nami-change-me' });

  // The UI never renders the entry point for a non-admin (admin-user-list.spec.ts),
  // but the write endpoint itself is the real authority - a direct call must be
  // denied too, exactly like the read endpoint (gated on the users:invite
  // permission, per SecurityConfig's SecuredEndpoint).
  const response = await page.request.post('/api/users', {
    data: { email: uniqueEmail('carrot'), roles: ['EDITOR'] },
  });
  expect(response.status()).toBe(403);
});
