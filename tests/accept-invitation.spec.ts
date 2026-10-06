import { expect, Page, test } from '@playwright/test';
import { crewCard, openCrewManifest, pickRole } from './support/crew-manifest';
import { invitationLink } from './support/mailpit';

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

// Unique per test run - see invite-user.spec.ts for the full rationale.
function uniqueEmail(handle: string): string {
  return `${handle}-${Date.now()}@onepiece.local`;
}

// UF-IDU-01 end to end: the invitation email (read from Mailpit) really lets the new
// crewmate set a password and sign in. Caught a realm regression where every required
// action but delete_account had been deleted and the link showed an empty step list
// (onepiece-infrastructure ADR-0013, "Correzione").
test('an invited crewmate activates the account from the email and signs in', async ({
  page,
  browser,
}) => {
  await login(page, ADMIN);
  await openCrewManifest(page);
  await page.getByRole('button', { name: 'New User' }).click();

  const email = uniqueEmail('brook');
  await page.getByLabel('Email').fill(email);
  await pickRole(page, 'EDITOR');
  await page.getByRole('button', { name: /Send Invitation/ }).click();
  // The confirmation toast is transient: the new card is the stable proof of the invite.
  await expect(crewCard(page, email)).toBeVisible();

  const link = await invitationLink(page.request, email);

  // A separate browser context, as the invitee's own browser would be: the admin's
  // Keycloak session would otherwise make Keycloak refuse the link
  // ("different_user_authenticated"). Manually created contexts do not inherit the
  // config's baseURL.
  const invitee = await (
    await browser.newContext({ baseURL: test.info().project.use.baseURL })
  ).newPage();
  await invitee.goto(link);

  // The step list the regression left empty.
  await expect(
    invitee.getByText(/Update Password, Update Profile, Verify Email/),
  ).toBeVisible();
  await invitee.getByRole('link', { name: /Click here to proceed/ }).click();

  const password = 'brook-yohoho-1';
  await invitee.locator('#password-new').fill(password);
  await invitee.locator('#password-confirm').fill(password);
  await invitee.getByRole('button', { name: 'Confirm' }).click();

  await invitee.locator('#firstName').fill('Brook');
  await invitee.locator('#lastName').fill('Soul King');
  await invitee.getByRole('button', { name: 'Confirm' }).click();

  // Completing the actions does not open a session: "Back to app" leads to the login
  // form, where the new password now works.
  await expect(invitee.getByText(/Your account has been updated/)).toBeVisible();
  await invitee.getByRole('link', { name: /Back to app/ }).click();
  await login(invitee, { username: email, password });

  await expect(invitee.getByRole('link', { name: 'Log Out' })).toBeVisible();
  const me = await invitee.request.get('/api/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(email);
});
