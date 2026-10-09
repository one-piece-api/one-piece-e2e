import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import {
  actOnRoute,
  actOnRow,
  blockedActions,
  confirm,
  createDevilFruit,
  createFruitType,
  denDenMushi,
  englishName,
  statusRow,
} from './support/content';
import { fruitImage } from './support/png';
import {
  devilFruitPath,
  fruitTypePath,
  getPublic,
  PublicDevilFruit,
  PublicFruitTypeDetail,
} from './support/public-api';

// A Devil Fruit and its type through the whole loop (content-service plan, step DF9): the
// relation's rules seen from the UI - a fruit is linked to a reviewed type, cannot go online
// before it, and keeps it online - and the result read from the public API, image included.

test('a fruit is linked to a reviewed type, goes online after it, and keeps it online', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  // Neither name contains the other, so a status row never matches the wrong content.
  const typeName = `E2E Kind ${stamp}`;
  const fruitName = `E2E Fruit ${stamp}`;

  // The type is written and approved, but stays offline for now.
  const chopper = await signIn(browser, 'chopper');
  await createFruitType(chopper, typeName);
  const typeCard = chopper.url();
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');

  const zoro = await signIn(browser, 'zoro');
  await actOnRow(zoro, 'in-review', typeName, 'CLAIM');
  await expect(denDenMushi(zoro)).toContainText('Claimed');
  await actOnRow(zoro, 'in-review', typeName, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  // The fruit links the approved type - the type search offers it - and carries an image.
  await createDevilFruit(chopper, fruitName, typeName, fruitImage());
  const fruitCard = chopper.url();
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');
  await actOnRow(zoro, 'in-review', fruitName, 'CLAIM');
  await expect(denDenMushi(zoro)).toContainText('Claimed');
  await actOnRow(zoro, 'in-review', fruitName, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  // Ready, but its type is not online. Rows do not know what is blocked (user-frontend
  // ADR-0004): trying from one is refused with the reason, and the card says it upfront.
  const vivi = await signIn(browser, 'vivi');
  await actOnRow(vivi, 'ready', fruitName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText("This fruit's type is not online");
  await expect(await blockedActions(vivi, fruitCard)).toContainText(
    "This fruit's type is not online",
  );

  // The type first, then the fruit.
  await actOnRow(vivi, 'ready', typeName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');
  await actOnRow(vivi, 'ready', fruitName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');

  // An online fruit keeps its type online: the type's card blocks retiring it and names the fruit.
  const blocked = await blockedActions(vivi, typeCard);
  await expect(blocked).toContainText('Fruits are online with this type');
  await expect(blocked.getByRole('link', { name: `${fruitName} no Mi` })).toBeVisible();
  await actOnRow(vivi, 'published', typeName, 'RETIRE');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('Fruits are online with this type');
  await vivi.goto('/dashboard/published');
  await expect(statusRow(vivi, typeName)).toBeVisible();

  // The public API: the fruit with its type and image, and the type listing the fruit.
  const fruitId = fruitCard.split('/').pop()!;
  const detail = await getPublic(request, devilFruitPath('en', fruitId));
  expect(detail.status()).toBe(200);
  const fruit: PublicDevilFruit = await detail.json();
  expect(fruit.name).toBe(englishName(fruitName));
  expect(fruit.type.name).toBe(englishName(typeName));

  const ofType = await getPublic(request, `${devilFruitPath('en')}?type=${fruit.type.slug}`);
  const page: { content: PublicDevilFruit[] } = await ofType.json();
  expect(page.content.map((listed) => listed.id)).toEqual([fruitId]);

  const type: PublicFruitTypeDetail = await (
    await getPublic(request, fruitTypePath('en', fruit.type.slug))
  ).json();
  expect(type.devilFruits.map((listed) => listed.id)).toEqual([fruitId]);

  const image = await getPublic(request, `/${fruit.image}`);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['cache-control']).toContain('immutable');
});
