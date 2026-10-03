import { expect, Locator, Page, test } from '@playwright/test';
import { signIn } from './support/crew';
import {
  actOnRoute,
  actOnRow,
  confirm,
  createFruitType,
  denDenMushi,
  fillEveryLanguage,
  statusRow,
} from './support/content';

// The editorial workflow of content-service, end to end through the real UI: each role is a
// different seeded user in a browser context of their own (support/crew.ts) - chopper writes
// (EDITOR), zoro reviews (REVIEWER), vivi publishes and retires (PUBLISHER), law writes and
// reviews (EDITOR + REVIEWER). Every run creates content under a fresh name, so it never
// collides with what an earlier run left behind (ADR-0001, "isolation via unique data").

/** An entry of the card's version list. */
function version(page: Page, label: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: label, exact: true }) });
}

function uniqueName(): string {
  return `E2E ${Date.now()}`;
}

test('a fruit type goes from draft to online, gets a second version, and is retired and republished', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const name = uniqueName();

  // An editor writes the first version and sends it to review.
  const chopper = await signIn(browser, 'chopper');
  await expect(chopper).toHaveURL(/\/dashboard$/);
  await createFruitType(chopper, name);
  const card = chopper.url();
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');

  // A reviewer claims it from the Review page, then approves it.
  const zoro = await signIn(browser, 'zoro');
  await actOnRow(zoro, 'in-review', name, 'CLAIM');
  await expect(denDenMushi(zoro)).toContainText('Claimed');
  await actOnRow(zoro, 'in-review', name, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  // A publisher puts it online, behind a confirmation.
  const vivi = await signIn(browser, 'vivi');
  await actOnRow(vivi, 'ready', name, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');

  // The editor opens a second version from the published one; v1 stays online meanwhile.
  await chopper.goto(card);
  await actOnRoute(chopper, 'New draft from v1');
  await expect(chopper.getByText('your draft v2 · v1 stays online')).toBeVisible();
  await fillEveryLanguage(chopper, name, 'Rewritten by the e2e suite');
  await chopper.getByRole('button', { name: 'Save draft' }).click();
  await expect(denDenMushi(chopper)).toContainText('Draft saved');
  await chopper.goto(card);
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');

  await actOnRow(zoro, 'in-review', name, 'CLAIM');
  await expect(denDenMushi(zoro)).toContainText('Claimed');
  await actOnRow(zoro, 'in-review', name, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  await actOnRow(vivi, 'ready', name, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v2 is online');

  // Publishing v2 superseded v1: the card now shows the rewritten text, v2 online.
  await vivi.goto(card);
  await expect(vivi.getByText('Rewritten by the e2e suite in English.')).toBeVisible();
  await expect(version(vivi, 'v2')).toContainText('online');
  await expect(version(vivi, 'v1')).not.toContainText('online');

  // Retired, the content goes offline; republished, the same version is back online.
  await actOnRow(vivi, 'published', name, 'RETIRE');
  await confirm(vivi);
  await expect(statusRow(vivi, name)).toHaveCount(0);
  await actOnRow(vivi, 'retired', name, 'RESTORE');
  await confirm(vivi);
  await expect(statusRow(vivi, name)).toHaveCount(0);

  await vivi.goto('/dashboard/published');
  await expect(statusRow(vivi, name)).toContainText('v2');
});

test('nobody reviews their own work, not even an editor who is also a reviewer', async ({
  browser,
}) => {
  const name = uniqueName();

  const law = await signIn(browser, 'law');
  await createFruitType(law, name);
  const contentId = new URL(law.url()).pathname.split('/').pop();
  await actOnRoute(law, 'Submit for review');
  await expect(denDenMushi(law)).toContainText('Submitted for review');

  // On their own submission the UI offers law only to pull it back, never to claim it.
  await law.goto('/dashboard/in-review');
  const row = statusRow(law, name);
  await expect(row.locator('[data-action="PULL_BACK"]')).toBeVisible();
  await expect(row.locator('[data-action="CLAIM"]')).toHaveCount(0);

  // The API is the real authority: a direct claim is refused too.
  const claim = await law.request.post(
    `/api/content/devil-fruit-types/${contentId}/versions/1/claim`,
  );
  expect(claim.status()).toBe(403);

  // Any other reviewer may take it.
  const zoro = await signIn(browser, 'zoro');
  await zoro.goto('/dashboard/in-review');
  await expect(statusRow(zoro, name).locator('[data-action="CLAIM"]')).toBeVisible();
});
