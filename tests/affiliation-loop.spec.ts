import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { actOnRoute, blockedActions, claimReview, confirm, denDenMushi } from './support/content';
import { chapterIdOf } from './support/bounty';
import { affiliationBody, createAffiliation, saveAffiliation } from './support/affiliation';
import { emblemImage, PUBLIC_IMAGE_PATH } from './support/images';
import {
  affiliationPath,
  getPublic,
  PublicAffiliation,
  PublicAffiliationSummary,
} from './support/public-api';
import { languageCodes, onlineChapter, reasonOf, retire } from './support/story';

// The affiliation through the whole loop (affiliation plan, step A4). The editors' way in the
// interface - a draft with its kind, emblem and first appearance, review, publication - then the
// public API in both languages with the emblem reachable, the natural key (a second romaji
// like the first is refused) and the first appearance (its chapter cannot be retired while the
// affiliation is online). Every content is retired at the end, newest first.

test('an affiliation with its emblem goes online, reads in both languages and keeps its chapter online', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  // The local database keeps the affiliations of earlier runs: this romaji is this run's own.
  const stamp = Date.now();
  const romaji = `E2E Ichimi ${stamp}`;
  const name = `E2E Crew ${stamp}`;
  const editor = await signIn(browser, 'chopper');
  const reviewer = await signIn(browser, 'zoro');
  const publisher = await signIn(browser, 'vivi');
  const crew = { editor, reviewer, publisher };
  const chapter = await onlineChapter(crew);

  // The draft, with its emblem and first appearance, through the whole editorial route.
  await createAffiliation(editor, {
    romaji,
    kind: 'PIRATE_CREW',
    name,
    firstAppearance: chapter,
    image: emblemImage(),
  });
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

  // The public API, in both languages: the name follows the language, the emblem is reachable.
  const languages = await languageCodes(editor);
  expect(languages.length).toBeGreaterThan(1);
  const english: PublicAffiliation = await (
    await getPublic(request, affiliationPath('en', id))
  ).json();
  const italian: PublicAffiliation = await (
    await getPublic(request, affiliationPath('it', id))
  ).json();
  expect(english).toMatchObject({ id, romaji, kind: 'PIRATE_CREW', name: `${name} (English)` });
  expect(italian).toMatchObject({ id, romaji, kind: 'PIRATE_CREW', name: `${name} (Italiano)` });
  expect(english.description).toBe(`${name} described in English.`);
  expect(english.firstAppearance.chapter?.number).toBe(chapter);
  expect(english.slug).toBe(italian.slug);
  expect((await getPublic(request, affiliationPath('en', english.slug))).status()).toBe(200);
  expect(english.image).toMatch(PUBLIC_IMAGE_PATH);
  const emblem = await getPublic(request, `/${english.image}`);
  expect(emblem.status()).toBe(200);
  expect(emblem.headers()['content-type']).toBe('image/webp');

  // The list: found by name, sorted by name, with the emblem.
  const page: { content: PublicAffiliationSummary[] } = await (
    await getPublic(request, `${affiliationPath('en')}?q=${encodeURIComponent(name)}`)
  ).json();
  expect(page.content.map((listed) => listed.id)).toEqual([id]);
  expect(page.content[0].image).toBe(english.image);
  expect(page.content[0].kind).toBe('PIRATE_CREW');

  // The kind filter: this affiliation is a pirate crew, not a Navy.
  const query = `q=${encodeURIComponent(name)}`;
  const pirates: { content: PublicAffiliationSummary[] } = await (
    await getPublic(request, `${affiliationPath('en')}?kind=PIRATE_CREW&${query}`)
  ).json();
  expect(pirates.content.map((listed) => listed.id)).toEqual([id]);
  const navy: { content: PublicAffiliationSummary[] } = await (
    await getPublic(request, `${affiliationPath('en')}?kind=NAVY&${query}`)
  ).json();
  expect(navy.content).toEqual([]);

  // The romaji is the natural key: a second affiliation with it is refused on save.
  const body = affiliationBody(languages, {
    romaji,
    kind: 'PIRATE_CREW',
    name: `${name} bis`,
    chapter: await chapterIdOf(editor, chapter),
  });
  const twice = await saveAffiliation(editor, body);
  expect(twice.status(), await twice.text()).toBe(422);
  expect(JSON.stringify(await twice.json())).toContain('romaji');

  // The first appearance keeps its chapter online: the card says it upfront, the API refuses.
  const blocked = await blockedActions(
    publisher,
    `/content/chapters/${await chapterIdOf(editor, chapter)}`,
  );
  await expect(blocked).toContainText('Online affiliations first appear here');
  const refused = await retire(crew, 'chapters', await chapterIdOf(editor, chapter));
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');

  // Retired, the affiliation disappears from the public API.
  const retired = await retire(crew, 'affiliations', id);
  expect(retired.status(), await retired.text()).toBe(200);
  expect((await getPublic(request, affiliationPath('en', id))).status()).toBe(404);
});
