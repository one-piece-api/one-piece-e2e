import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { actOnRoute, claimReview, confirm, denDenMushi } from './support/content';
import { chapterIdOf } from './support/bounty';
import { characterBody, createCharacter, inLanguage, saveCharacter } from './support/character';
import { characterImage, PUBLIC_IMAGE_PATH } from './support/images';
import { speciesBody } from './support/species';
import {
  characterPath,
  getPublic,
  PublicCharacter,
  PublicCharacterSummary,
  speciesPath,
} from './support/public-api';
import { languageCodes, onlineChapter, putOnline, reasonOf, retire } from './support/story';

// The character through the whole loop (character plan, step C4). The editors' way in the
// interface - the lists of species, epithets and aliases, the birthday and the portrait,
// review, publication - then the public API in both languages (epithets in the language of
// the reader, species and aliases in the editor's order, the birthday as `--MM-DD`, the
// portrait reachable) with the filters by species and by status, and the rules the API
// refuses: the natural key, an alias repeated, an epithet missing in a language, and the
// retirement of a species an online character names. Every content is retired at the end.

const BIRTHDAY = { day: 5, month: 5 };

test('a character with its lists goes online, reads in both languages and keeps its species online', async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  // The local database keeps the characters of earlier runs: these names are this run's own.
  const stamp = Date.now();
  const romaji = `E2E Monkey ${stamp}`;
  const name = `E2E Character ${stamp}`;
  const first = `E2E Alpha ${stamp}`;
  const second = `E2E Beta ${stamp}`;
  const unrelated = `E2E Gamma ${stamp}`;
  const editor = await signIn(browser, 'chopper');
  const reviewer = await signIn(browser, 'zoro');
  const publisher = await signIn(browser, 'vivi');
  const crew = { editor, reviewer, publisher };
  const chapter = await onlineChapter(crew);
  const chapterId = await chapterIdOf(editor, chapter);
  const languages = await languageCodes(editor);
  expect(languages.length).toBeGreaterThan(1);

  // Three species online: the character names two, in this order; the third names no one.
  const online = (species: string) =>
    putOnline(
      crew,
      'species',
      speciesBody(languages, {
        romaji: species,
        name: species,
        chapter: chapterId,
      }),
    );
  const firstId = await online(first);
  const secondId = await online(second);
  const unrelatedId = await online(unrelated);

  // The draft, with every list and its portrait, through the whole editorial route.
  const epithets = ['Straw Hat', 'Rubber Man'];
  const aliases = ['Mugiwara', 'Captain'];
  await createCharacter(editor, languages, {
    romaji,
    name,
    japaneseName: 'モンキー・D・ルフィ',
    status: 'ALIVE',
    gender: 'MALE',
    birthday: BIRTHDAY,
    firstAppearance: chapter,
    image: characterImage(),
    epithets,
    aliases,
    species: [first, second],
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

  // The public API, in both languages: the epithets follow the language, the rest stays.
  const english: PublicCharacter = await (await getPublic(request, characterPath('en', id))).json();
  const italian: PublicCharacter = await (await getPublic(request, characterPath('it', id))).json();
  expect(english).toMatchObject({
    id,
    romaji,
    name: `${name} (English)`,
    japaneseName: 'モンキー・D・ルフィ',
    status: 'ALIVE',
    gender: 'MALE',
    birthday: '--05-05',
  });
  expect(italian.name).toBe(`${name} (Italiano)`);
  expect(english.description).toBe(`${name} described in English.`);
  expect(english.epithets).toEqual(epithets.map((epithet) => inLanguage(epithet, 'en')));
  expect(italian.epithets).toEqual(epithets.map((epithet) => inLanguage(epithet, 'it')));
  expect(english.aliases).toEqual(aliases);
  expect(italian.aliases).toEqual(aliases);
  expect(english.species.map((species) => species.id)).toEqual([firstId, secondId]);
  expect(english.species[0].name).toBe(`${first} (en)`);
  expect(italian.species[0].name).toBe(`${first} (it)`);
  expect(english.firstAppearance.chapter?.number).toBe(chapter);
  expect(english.slug).toBe(italian.slug);
  expect((await getPublic(request, characterPath('en', english.slug))).status()).toBe(200);
  expect(english.image).toMatch(PUBLIC_IMAGE_PATH);
  const portrait = await getPublic(request, `/${english.image}`);
  expect(portrait.status()).toBe(200);
  expect(portrait.headers()['content-type']).toBe('image/webp');

  // The list: found by name with its portrait, narrowed by species and by status.
  const listed = async (filter: string): Promise<PublicCharacterSummary[]> => {
    const response = await getPublic(
      request,
      `${characterPath('en')}?q=${encodeURIComponent(name)}${filter}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    return ((await response.json()) as { content: PublicCharacterSummary[] }).content;
  };
  const found = await listed('');
  expect(found.map((character) => character.id)).toEqual([id]);
  expect(found[0].image).toBe(english.image);
  expect((await listed(`&species=${secondId}`)).map((character) => character.id)).toEqual([id]);
  expect(await listed(`&species=${unrelatedId}`)).toEqual([]);
  expect((await listed('&status=ALIVE')).map((character) => character.id)).toEqual([id]);
  expect(await listed('&status=DECEASED')).toEqual([]);

  // A species an online character names stays online; once the character is retired it can go.
  const refused = await retire(crew, 'species', firstId);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');
  expect((await getPublic(request, speciesPath('en', firstId))).status()).toBe(200);

  const gone = await retire(crew, 'characters', id);
  expect(gone.status(), await gone.text()).toBe(200);
  expect((await getPublic(request, characterPath('en', id))).status()).toBe(404);
  for (const species of [secondId, firstId, unrelatedId]) {
    const retired = await retire(crew, 'species', species);
    expect(retired.status(), await retired.text()).toBe(200);
  }
});

test('the character rules refuse a repeated romaji, a repeated alias and an epithet missing in a language', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const romaji = `E2E Zoro ${stamp}`;
  const name = `E2E Rules ${stamp}`;
  const editor = await signIn(browser, 'chopper');
  const reviewer = await signIn(browser, 'zoro');
  const publisher = await signIn(browser, 'vivi');
  const chapter = await chapterIdOf(editor, await onlineChapter({ editor, reviewer, publisher }));
  const languages = await languageCodes(editor);
  const missing = 'en';
  const written = languages.find((code) => code !== missing)!;
  expect(languages).toContain(missing);

  // The natural key: a second character with the same romaji is refused on save.
  const saved = await saveCharacter(editor, characterBody(languages, { romaji, name, chapter }));
  expect(saved.status(), await saved.text()).toBe(201);
  const twice = await saveCharacter(
    editor,
    characterBody(languages, { romaji, name: `${name} bis`, chapter }),
  );
  expect(twice.status(), await twice.text()).toBe(422);
  expect(JSON.stringify(await twice.json())).toContain('romaji');

  // An alias repeated, whatever the case, names the later entry.
  const repeated = await saveCharacter(
    editor,
    characterBody(languages, {
      romaji: `${romaji} alias`,
      name: `${name} alias`,
      chapter,
      aliases: ['Sogeking', 'sogeking'],
    }),
  );
  expect(repeated.status(), await repeated.text()).toBe(422);
  expect(JSON.stringify(await repeated.json())).toContain('aliases[1]');

  // An epithet written in one language only is a draft, but blocks the submission.
  const draft = await saveCharacter(
    editor,
    characterBody(languages, {
      romaji: `${romaji} epithet`,
      name: `${name} epithet`,
      chapter,
      epithets: [{ [written]: 'Cat Burglar' }],
    }),
  );
  expect(draft.status(), await draft.text()).toBe(201);
  const id = (await draft.json()).id;
  const submitted = await editor.request.post(`/api/content/characters/${id}/versions/1/submit`);
  expect(submitted.status(), await submitted.text()).toBe(422);
  const problem = await submitted.json();
  expect(problem.errorCode).toBe('CONTENT_VERSION_INCOMPLETE');
  expect(problem.errors.map((error: { field: string }) => error.field)).toContain(
    `epithets[0].text[${missing}]`,
  );
});
