import { expect, test } from '@playwright/test';

// "nami" (EDITOR), seeded declaratively by
// onepiece-infrastructure/keycloak/realm-onepiece.json - not luffy/usopp,
// which other specs in this suite depend on staying present for the
// duration of a run (see docs/adr/0001-e2e-environment-strategy.md). This
// spec never actually completes the deletion (see below), so reusing a
// shared seeded user is safe either way, but picking a non-admin one keeps
// the intent obvious.
const USERNAME = 'nami';
const PASSWORD = 'nami-change-me';

test('the "Delete My Account" link redirects straight to Keycloak\'s hosted account-deletion flow', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#username').fill(USERNAME);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();

  // Scoped to the page-header heading, not "main", to avoid a strict-mode
  // ambiguity with the Identity card's own username row - a pre-existing
  // issue also affecting login.spec.ts's identical pattern, not introduced
  // here and not fixed here (see implementation-plan.md's Step 17 notes).
  await expect(page.getByRole('heading', { name: USERNAME })).toBeVisible();

  // No app-side confirmation modal: the link goes straight to Keycloak's own
  // "account" client (never through oauth2-proxy/onepiece-proxy - see
  // auth-urls.ts), which requires a fresh re-authentication before honoring
  // "delete_account" even with a live SSO session (Keycloak's own step-up
  // behavior for this action) - that step-up, plus Keycloak's own explicit
  // Confirm/Cancel step, is the real confirmation safeguard.
  await page.getByRole('link', { name: 'Delete My Account' }).click();
  await expect(page.getByText(/re-enter your password/i)).toBeVisible();
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();

  // Land on Keycloak's own hosted confirmation page - never actually
  // confirmed here (no "Confirm Deletion" click): completing it would
  // delete a seeded user other specs may still depend on. The app's job
  // ends at this handoff; Keycloak owns everything from here on.
  await expect(page.getByText(/irreversible/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm Deletion/i })).toBeVisible();
});
