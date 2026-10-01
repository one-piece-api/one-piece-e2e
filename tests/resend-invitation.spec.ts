import { expect, Page, test } from '@playwright/test';
import { cardStatus, crewCard, pickRole } from './support/crew-manifest';

// Credentials for users seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json - see
// admin-user-list.spec.ts for the full seeded-user rationale.
const ADMIN = { username: 'luffy', password: 'luffy-change-me' };
const LUFFY_EMAIL = 'luffy@onepiece.local';

// This whole spec exercises UF-IDU-03's INVITATION_EXPIRED gating (ADR-0004 in
// one-piece-user-service) against a real Keycloak - which only becomes reachable in a
// CI-length run because the Helmfile "ci" environment overrides
// keycloak.invitation.token-lifespan down to PT5S (see onepiece-infrastructure
// ADR-0006-short-invitation-lifespan-in-ci.md). Against a cluster synced with the
// "default" environment (plain ./scripts/setup.sh, PT12H) the invitation never actually
// expires within this suite's timeout - run with HELMFILE_ENVIRONMENT=ci instead.

async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto('/');
  await page.locator('#username').fill(credentials.username);
  await page.locator('#password').fill(credentials.password);
  await page.locator('#kc-login').click();
}

// Unique per test run - see invite-user.spec.ts for the full rationale.
function uniqueEmail(handle: string): string {
  return `${handle}-${Date.now()}@onepiece.local`;
}

/** Opens the invite modal, submits it, and returns the invited user's own userId/email. */
async function inviteUser(
  page: Page,
  email: string,
  role: 'ADMIN' | 'REVIEWER' | 'EDITOR' = 'EDITOR',
): Promise<{ userId: string; email: string }> {
  await page.getByRole('button', { name: 'New User' }).click();
  await page.getByLabel('Email').fill(email);
  await pickRole(page, role);
  await page.getByRole('button', { name: /Send Invitation/ }).click();

  // Reading the POST response body directly (page.waitForResponse(...).json()) raced
  // whatever the app does right after the click and intermittently hit Playwright's
  // "Response body is not available for a response that was navigated away from" -
  // findUserId's own separate, out-of-band request sidesteps that race entirely.
  await expect(page.getByText(new RegExp(`Invitation sent to ${email}`))).toBeVisible();
  return { userId: await findUserId(page, email), email };
}

async function findUserId(page: Page, email: string): Promise<string> {
  const response = await page.request.get('/api/users?page=0&size=100');
  const body = await response.json();
  const match = (body.content as Array<{ userId: string; email: string }>).find(
    (user) => user.email === email,
  );
  if (!match) {
    throw new Error(`No user found for ${email} in the admin listing`);
  }
  return match.userId;
}

test('resending a still-valid invitation is rejected', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();

  const email = uniqueEmail('brook');
  const invited = await inviteUser(page, email);

  await expect(cardStatus(crewCard(page, email), 'Pending')).toBeVisible();
  // The link is still within its own lifespan - the UI never offers resend for it
  // (resend lives on the crewmate's detail page, not in the listing).
  await crewCard(page, email).getByRole('link', { name: /Details/ }).click();
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Resend Invitation/ })).toHaveCount(0);

  const response = await page.request.post(
    `/api/users/${invited.userId}/resend-invitation`,
  );
  expect(response.status()).toBe(409);
  expect((await response.json()).errorCode).toBe('USER_INVITATION_NOT_RESENDABLE');
});

test('resending an invitation for an unknown user is rejected', async ({ page }) => {
  await login(page, ADMIN);

  const response = await page.request.post(
    '/api/users/00000000-0000-0000-0000-000000000000/resend-invitation',
  );
  expect(response.status()).toBe(404);
  expect((await response.json()).errorCode).toBe('USER_NOT_FOUND');
});

test('resending an invitation for an already-active user is rejected', async ({ page }) => {
  await login(page, ADMIN);

  const luffyId = await findUserId(page, LUFFY_EMAIL);
  const response = await page.request.post(`/api/users/${luffyId}/resend-invitation`);
  expect(response.status()).toBe(409);
  expect((await response.json()).errorCode).toBe('USER_INVITATION_NOT_RESENDABLE');
});

test('an admin resends an expired invitation and the crewmate becomes pending again', async ({
  page,
}) => {
  test.setTimeout(45_000);

  await login(page, ADMIN);
  await page.getByRole('link', { name: /Crew Manifest/ }).click();

  const email = uniqueEmail('jinbe');
  await inviteUser(page, email);
  const card = crewCard(page, email);

  // No polling interval shorter than the current link's own lifespan would ever observe
  // it going stale - reload until the admin-events-derived status catches up.
  await expect(async () => {
    await page.reload();
    await expect(cardStatus(card, 'Invite Expired')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000, intervals: [1_000] });

  // Resend is offered on the detail page, reached from the card's "Details" link.
  await card.getByRole('link', { name: /Details/ }).click();
  await page.getByRole('button', { name: /Resend Invitation/ }).click();

  await expect(page.getByText(new RegExp(`Resent the invitation to ${email}`))).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Resend Invitation/ })).toHaveCount(0);
});
