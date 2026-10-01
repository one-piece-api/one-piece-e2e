import { expect, Page, test } from '@playwright/test';
import { cardStatus, crewCard, crewCards } from './support/crew-manifest';

// Credentials for users seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json — not secrets, they
// only exist in the ephemeral, local-only Keycloak realm this suite runs
// against (see docs/adr/0001-e2e-environment-strategy.md). The realm seeds a
// deliberate spread of roles and account statuses (luffy: ADMIN/active,
// nami: EDITOR/active, zoro: REVIEWER/active, sanji: EDITOR/disabled,
// usopp: EDITOR/pending) so this suite exercises the listing (UF-IDU-17)
// against realistic, varied data rather than a single user. Three more
// accounts come from onepiece-infrastructure/scripts/seed-content-qa-users.sh
// (chopper: EDITOR, vivi: PUBLISHER, law: EDITOR + REVIEWER), seeded for the
// content editorial workflow - same password convention.
const ADMIN = { username: 'luffy', password: 'luffy-change-me' };
const NON_ADMIN = { username: 'nami', password: 'nami-change-me' };

async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto('/');
  await page.locator('#username').fill(credentials.username);
  await page.locator('#password').fill(credentials.password);
  await page.locator('#kc-login').click();
}

test('an admin sees the full crew manifest with every role and status represented', async ({
  page,
}) => {
  await login(page, ADMIN);

  await page.getByRole('link', { name: /Crew Manifest/ }).click();
  await expect(page.getByRole('heading', { name: /Crew Manifest/ })).toBeVisible();

  const rows = crewCards(page);
  await expect(rows).toHaveCount(8);

  // Rows are identified by username now (UF-IDU-02/§2 of
  // application-user-identity-management.md) - all seeded users have a
  // real, distinct-from-email username since they're seeded directly rather
  // than provisioned through the invite flow (where username defaults to the
  // email placeholder until activation).
  const luffyRow = crewCard(page, 'luffy');
  await expect(cardStatus(luffyRow, 'Active')).toBeVisible();
  await expect(luffyRow.getByText('ADMIN', { exact: true })).toBeVisible();

  const namiRow = crewCard(page, 'nami');
  await expect(cardStatus(namiRow, 'Active')).toBeVisible();
  await expect(namiRow.getByText('EDITOR', { exact: true })).toBeVisible();

  const zoroRow = crewCard(page, 'zoro');
  await expect(cardStatus(zoroRow, 'Active')).toBeVisible();
  await expect(zoroRow.getByText('REVIEWER', { exact: true })).toBeVisible();

  const sanjiRow = crewCard(page, 'sanji');
  await expect(cardStatus(sanjiRow, 'Disabled')).toBeVisible();

  const usoppRow = crewCard(page, 'usopp');
  await expect(cardStatus(usoppRow, 'Pending')).toBeVisible();

  const viviRow = crewCard(page, 'vivi');
  await expect(viviRow.getByText('PUBLISHER', { exact: true })).toBeVisible();

  const lawRow = crewCard(page, 'law');
  await expect(lawRow.getByText('EDITOR', { exact: true })).toBeVisible();
  await expect(lawRow.getByText('REVIEWER', { exact: true })).toBeVisible();

  // Keycloak assigns every account its own "default-roles-onepiece"
  // composite role automatically - it must never leak into the listing as
  // if it were a role an ADMIN assigned.
  await expect(page.getByText('default-roles')).toHaveCount(0);
});

test('a non-admin cannot reach the crew manifest', async ({ page }) => {
  await login(page, NON_ADMIN);

  // The page title is the signed-in username; the identity card repeats it, so
  // target the heading to keep this locator unambiguous.
  await expect(page.getByRole('heading', { level: 1, name: 'nami' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Crew Manifest/ })).toHaveCount(0);

  // Direct navigation is stopped by the permission-driven route guard (users:read) even
  // though the UI never renders a link to get here; the backend stays the actual
  // authority (UF-IDU-16/SecurityConfig's SecuredEndpoint, see invite-user.spec.ts).
  await page.goto('/users');
  await expect(page.getByRole('heading', { level: 1, name: 'This cabin is locked' })).toBeVisible();
});
