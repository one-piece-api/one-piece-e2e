import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { actOnRoute, blockedActions, claimReview, confirm, denDenMushi } from './support/content';
import { chapterIdOf } from './support/bounty';
import { createSpecies, saveSpecies, speciesBody } from './support/species';
import { speciesImage, PUBLIC_IMAGE_PATH } from './support/images';
import { getPublic, PublicSpecies, PublicSpeciesSummary, speciesPath } from './support/public-api';
import { languageCodes, onlineChapter, reasonOf, retire } from './support/story';

// The species through the whole loop (species plan, step S4). The editors' way in the
// interface - a draft with its picture and first appearance, review, publication - then the
// public API in both languages with the picture reachable, the natural key (a second romaji
// like the first is refused), the linkable list a character will pick from, and the first
// appearance (its chapter cannot be retired while the species is online). Every content is
// retired at the end, newest first.

test('a species with its picture goes online, reads in both languages and keeps its chapter online', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  // The local database keeps the species of earlier runs: this romaji is this run's own.
  const stamp = Date.now();
  const romaji = `E2E Gyojin ${stamp}`;
  const name = `E2E Species ${stamp}`;
  const editor = await signIn(browser, 'chopper');
  const reviewer = await signIn(browser, 'zoro');
  const publisher = await signIn(browser, 'vivi');
  const crew = { editor, reviewer, publisher };
  const chapter = await onlineChapter(crew);

  // The draft, with its picture and first appearance, through the whole editorial route.
  await createSpecies(editor, { romaji, name, firstAppearance: chapter, image: speciesImage() });
  const card = editor.url();
  const id = card.split('/').pop()!;
  await expect(editor.getByTestId('card-name')).toContainText(name);
  await actOnRoute(editor, 'Submit for review');
  await expect(denDenMushi(editor)).toContainText('Submitted for review');
  await reviewer.goto(card);
  await claimReview(reviewer);
  await expect(denDenMushi(reviewer)).toContainText('Claimed');
  await actOnRoute(reviewer, 'Approve');
  await expect(denDenMushi(reviewer)).toContainText('Approved');
  await publisher.goto(card);
  await actOnRoute(publisher, 'Publish');
  await confirm(publisher);
  await expect(denDenMushi(publisher)).toContainText('v1 is online');

  // The public API, in both languages: the name follows the language, the picture is reachable.
  const languages = await languageCodes(editor);
  expect(languages.length).toBeGreaterThan(1);
  const english: PublicSpecies = await (await getPublic(request, speciesPath('en', id))).json();
  const italian: PublicSpecies = await (await getPublic(request, speciesPath('it', id))).json();
  expect(english).toMatchObject({ id, romaji, name: `${name} (English)` });
  expect(italian).toMatchObject({ id, romaji, name: `${name} (Italiano)` });
  expect(english.description).toBe(`${name} described in English.`);
  expect(english.firstAppearance.chapter?.number).toBe(chapter);
  expect(english.slug).toBe(italian.slug);
  expect((await getPublic(request, speciesPath('en', english.slug))).status()).toBe(200);
  expect(english.image).toMatch(PUBLIC_IMAGE_PATH);
  const picture = await getPublic(request, `/${english.image}`);
  expect(picture.status()).toBe(200);
  expect(picture.headers()['content-type']).toBe('image/webp');

  // The list: found by name, with the picture.
  const page: { content: PublicSpeciesSummary[] } = await (
    await getPublic(request, `${speciesPath('en')}?q=${encodeURIComponent(name)}`)
  ).json();
  expect(page.content.map((listed) => listed.id)).toEqual([id]);
  expect(page.content[0].image).toBe(english.image);

  // The romaji is the natural key: a second species with it is refused on save.
  const body = speciesBody(languages, {
    romaji,
    name: `${name} bis`,
    chapter: await chapterIdOf(editor, chapter),
  });
  const twice = await saveSpecies(editor, body);
  expect(twice.status(), await twice.text()).toBe(422);
  expect(JSON.stringify(await twice.json())).toContain('romaji');

  // The species a character may be linked to: this one, once approved, found by its name.
  const linkable = await editor.request.get(
    `/api/content/species/linkable?q=${encodeURIComponent(name)}`,
  );
  expect(linkable.status(), await linkable.text()).toBe(200);
  const linked: { content: { id: string; romaji: string }[] } = await linkable.json();
  expect(linked.content).toEqual([expect.objectContaining({ id, romaji })]);

  // The first appearance keeps its chapter online: the card says it upfront, the API refuses.
  const blocked = await blockedActions(
    publisher,
    `/content/chapters/${await chapterIdOf(editor, chapter)}`,
  );
  await expect(blocked).toContainText('Online species first appear here');
  const refused = await retire(crew, 'chapters', await chapterIdOf(editor, chapter));
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');

  // Retired, the species disappears from the public API.
  const retired = await retire(crew, 'species', id);
  expect(retired.status(), await retired.text()).toBe(200);
  expect((await getPublic(request, speciesPath('en', id))).status()).toBe(404);
});
