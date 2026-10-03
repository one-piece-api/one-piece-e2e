import { Browser, expect, Page } from '@playwright/test';

/**
 * Users seeded for the local realm (onepiece-infrastructure's realm-onepiece.json and
 * scripts/seed-content-qa-users.sh). Not secrets: the password convention is
 * "<username>-change-me" and the accounts only exist in the throwaway e2e cluster.
 */
export type CrewMember = 'luffy' | 'nami' | 'zoro' | 'chopper' | 'vivi' | 'law';

/**
 * Signs a crew member in through oauth2-proxy and Keycloak, in a browser context of their own,
 * so that several identities can act on the same content within one test.
 */
export async function signIn(browser: Browser, username: CrewMember, path = '/'): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(`${username}-change-me`);
  await page.locator('#kc-login').click();
  await expect(page.locator('#kc-login')).toHaveCount(0);
  return page;
}
