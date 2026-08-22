import { expect, Page, test } from '@playwright/test';

// Credentials for users seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json — not secrets, they
// only exist in the ephemeral, local-only Keycloak realm this suite runs
// against (see docs/adr/0001-e2e-environment-strategy.md). The realm seeds a
// deliberate spread of roles and account statuses (luffy: ADMIN/active,
// nami: EDITOR/active, zoro: REVIEWER/active, sanji: EDITOR/disabled,
// usopp: EDITOR/pending) so this suite exercises the listing (UF-IDU-17)
// against realistic, varied data rather than a single user.
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

  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(5);

  const luffyRow = rows.filter({ hasText: 'luffy@onepiece.local' });
  await expect(luffyRow.getByText('Active')).toBeVisible();
  await expect(luffyRow.getByText('ADMIN', { exact: true })).toBeVisible();

  const namiRow = rows.filter({ hasText: 'nami@onepiece.local' });
  await expect(namiRow.getByText('Active')).toBeVisible();
  await expect(namiRow.getByText('EDITOR', { exact: true })).toBeVisible();

  const zoroRow = rows.filter({ hasText: 'zoro@onepiece.local' });
  await expect(zoroRow.getByText('Active')).toBeVisible();
  await expect(zoroRow.getByText('REVIEWER', { exact: true })).toBeVisible();

  const sanjiRow = rows.filter({ hasText: 'sanji@onepiece.local' });
  await expect(sanjiRow.getByText('Disabled')).toBeVisible();

  const usoppRow = rows.filter({ hasText: 'usopp@onepiece.local' });
  await expect(usoppRow.getByText('Pending')).toBeVisible();

  // Keycloak assigns every account its own "default-roles-onepiece"
  // composite role automatically - it must never leak into the listing as
  // if it were a role an ADMIN assigned.
  await expect(page.getByText('default-roles')).toHaveCount(0);
});

test('a non-admin cannot reach the crew manifest', async ({ page }) => {
  await login(page, NON_ADMIN);

  await expect(page.getByText('nami@onepiece.local')).toBeVisible();
  await expect(page.getByRole('link', { name: /Crew Manifest/ })).toHaveCount(0);

  // The backend is the actual authority here (UF-IDU-16/SecurityConfig
  // "/admin/**" -> hasRole("ADMIN")) - direct navigation must still be
  // denied even though the UI never renders a link to get here.
  await page.goto('/admin/users');
  await expect(page.getByText(/Lost the manifest/)).toBeVisible();
});
