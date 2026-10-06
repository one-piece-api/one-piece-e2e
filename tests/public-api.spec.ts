import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import {
  actOnRoute,
  actOnRow,
  confirm,
  createFruitType,
  denDenMushi,
  englishName,
  fillEveryLanguage,
  statusRow,
} from './support/content';
import { fruitTypePath, getPublic, PublicFruitType } from './support/public-api';

// The editorial workflow seen from the public read API (public-api plan D15): what a
// publisher puts online appears in the API, what they retire disappears, and a corrected
// romaji moves the slug while the old one keeps answering with a redirect. The API is
// read through the gateway route, as on the remote (support/public-api.ts).

function uniqueName(): string {
  return `E2E API ${Date.now()}`;
}

test('published content appears in the public API, a new romaji redirects, retired content is gone', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const name = uniqueName();

  // v1: written, reviewed and published through the real UI.
  const chopper = await signIn(browser, 'chopper');
  await createFruitType(chopper, name);
  const card = chopper.url();
  const contentId = card.split('/').pop()!;
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');

  const zoro = await signIn(browser, 'zoro');
  await actOnRow(zoro, 'in-review', name, 'CLAIM');
  await expect(denDenMushi(zoro)).toContainText('Claimed');
  await actOnRow(zoro, 'in-review', name, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  const vivi = await signIn(browser, 'vivi');
  await actOnRow(vivi, 'ready', name, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');

  // Online: readable by UUID, and by the slug the API derives from the romaji.
  const byId = await getPublic(request, fruitTypePath('en', contentId));
  expect(byId.status()).toBe(200);
  const v1: PublicFruitType = await byId.json();
  expect(v1.name).toBe(englishName(name));
  expect((await getPublic(request, fruitTypePath('en', v1.slug))).status()).toBe(200);

  // v2 corrects the romaji: the new slug answers, the old one redirects to it.
  await chopper.goto(card);
  await actOnRoute(chopper, 'New draft from v1');
  await chopper.getByLabel('Romaji').fill(`${name}-kai`);
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

  const v2: PublicFruitType = await (await getPublic(request, fruitTypePath('en', contentId))).json();
  expect(v2.slug).not.toBe(v1.slug);
  const oldSlug = await getPublic(request, fruitTypePath('en', v1.slug));
  expect(oldSlug.status()).toBe(301);
  // A relative Location, resolved against the request path as any HTTP client does.
  const target = new URL(oldSlug.headers()['location'], `http://api${fruitTypePath('en', v1.slug)}`);
  expect(target.pathname).toBe(fruitTypePath('en', v2.slug));

  // Retired: gone from the API, by UUID and by slug.
  await actOnRow(vivi, 'published', name, 'RETIRE');
  await confirm(vivi);
  await expect(statusRow(vivi, name)).toHaveCount(0);
  expect((await getPublic(request, fruitTypePath('en', contentId))).status()).toBe(404);
  expect((await getPublic(request, fruitTypePath('en', v2.slug))).status()).toBe(404);
});
