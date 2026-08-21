import { expect, test } from '@playwright/test';

// Credentials for the "luffy" user seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json — not a secret, it
// only exists in the ephemeral, local-only Keycloak realm this suite runs
// against (see docs/adr/0001-e2e-environment-strategy.md).
const USERNAME = 'luffy';
const PASSWORD = 'luffy-change-me';

test('an authenticated pirate sees their identity and can abandon ship', async ({ page }) => {
  await page.goto('/');

  // oauth2-proxy redirects the unauthenticated request to Keycloak's login
  // page (default keycloakx theme field ids).
  await page.locator('#username').fill(USERNAME);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();

  await expect(page.getByText('luffy@onepiece.local')).toBeVisible();
  await expect(page.getByText('ADMIN')).toBeVisible();

  await page.getByRole('link', { name: /Abandon Ship/ }).click();

  // Keycloak inserts a confirmation step here: the logout request carries
  // no id_token_hint (the SPA never holds the token — oauth2-proxy keeps it
  // server-side), and without that hint RP-initiated logout requires
  // explicit confirmation per the OIDC spec, rather than logging out on a
  // bare redirect.
  await page.getByRole('button', { name: 'Logout' }).click();

  // Full logout (UF-IDU-08) ends both the proxy and the Keycloak SSO
  // session, so a fresh visit lands back on the login form rather than
  // silently re-authenticating.
  await expect(page.locator('#username')).toBeVisible();
});
