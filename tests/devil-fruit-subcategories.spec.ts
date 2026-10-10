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
} from './support/content';
import { fruitImage } from './support/png';
import {
  devilFruitPath,
  fruitTypePath,
  getPublic,
  PublicDevilFruit,
  PublicFruitTypeDetail,
} from './support/public-api';

// Type subcategories through the whole loop (subcategories plan, step SC4): a type with three
// subcategories, a fruit naming one, the result in the public API, and the type's next version
// refused while an online fruit still uses a subcategory it drops.

test('a fruit names a subcategory of its type, and an online fruit keeps it online', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const typeName = `E2E Zoan ${stamp}`;
  const fruitName = `E2E Beast ${stamp}`;
  const subcategories = [`Ancient ${stamp}`, `Mythical ${stamp}`, `Artificial ${stamp}`];
  const [, mythical] = subcategories;

  const chopper = await signIn(browser, 'chopper');
  const zoro = await signIn(browser, 'zoro');
  const vivi = await signIn(browser, 'vivi');

  // The type with its subcategories goes online.
  await createFruitType(chopper, typeName, subcategories);
  const typeCard = chopper.url();
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');
  await actOnRow(zoro, 'in-review', typeName, 'CLAIM');
  await actOnRow(zoro, 'in-review', typeName, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');
  await actOnRow(vivi, 'ready', typeName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');

  // A fruit picks one of them and goes online.
  await createDevilFruit(chopper, fruitName, typeName, fruitImage(), mythical);
  const fruitId = chopper.url().split('/').pop()!;
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');
  await actOnRow(zoro, 'in-review', fruitName, 'CLAIM');
  await actOnRow(zoro, 'in-review', fruitName, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');
  await actOnRow(vivi, 'ready', fruitName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('v1 is online');

  // The public API: the fruit's subcategory, the type's list in order, and `type=` unchanged.
  const fruit: PublicDevilFruit = await (
    await getPublic(request, devilFruitPath('en', fruitId))
  ).json();
  expect(fruit.subcategory?.name).toBe(englishName(mythical));

  const type: PublicFruitTypeDetail = await (
    await getPublic(request, fruitTypePath('en', fruit.type.slug))
  ).json();
  expect(type.subcategories.map((listed) => listed.name)).toEqual(
    subcategories.map(englishName),
  );
  expect(type.subcategories[1].id).toBe(fruit.subcategory?.id);

  const ofType = await getPublic(request, `${devilFruitPath('en')}?type=${fruit.type.slug}`);
  const page: { content: PublicDevilFruit[] } = await ofType.json();
  expect(page.content.map((listed) => listed.id)).toEqual([fruitId]);

  // A second type version that drops Mythical is refused while the fruit is online.
  await chopper.goto(typeCard);
  await actOnRoute(chopper, 'New draft from v1');
  await expect(chopper.getByText('your draft v2 · v1 stays online')).toBeVisible();
  await chopper.getByTestId('subcategory-entry').nth(1).getByTestId('subcategory-remove').click();
  await chopper.getByRole('button', { name: 'Save draft' }).click();
  await expect(denDenMushi(chopper)).toContainText('Draft saved');
  await chopper.goto(typeCard);
  await actOnRoute(chopper, 'Submit for review');
  await expect(denDenMushi(chopper)).toContainText('Submitted for review');
  await actOnRow(zoro, 'in-review', typeName, 'CLAIM');
  await actOnRow(zoro, 'in-review', typeName, 'APPROVE');
  await expect(denDenMushi(zoro)).toContainText('Approved');

  await expect(await blockedActions(vivi, typeCard)).toContainText(
    'drops a subcategory used by online Fruits',
  );
  await actOnRow(vivi, 'ready', typeName, 'PUBLISH');
  await confirm(vivi);
  await expect(denDenMushi(vivi)).toContainText('drops a subcategory used by online Fruits');
});
