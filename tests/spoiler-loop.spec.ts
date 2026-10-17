import { expect, Page, test } from '@playwright/test';
import { signIn } from './support/crew';
import { fruitImage } from './support/png';
import { devilFruitPath, fruitTypePath, getPublic } from './support/public-api';
import {
  approve,
  Crew,
  freshNumber,
  languageCodes,
  publish,
  putOnline,
  translationsOf,
} from './support/story';

// The spoiler loop (timeline plan, TL7): the Gomu Gomu no Mi of the reference case
// (content-service GomuGomuReveals), met at chapter 1 as a Paramecia and revealed at chapter
// 1044 as the Hito Hito no Mi, Model: Nika, a Mythical Zoan - written and published through
// the content API, then read from the public API as known at each chapter (T8, T13).
// Chapter numbers are unique forever, so every run takes a fresh base: base = "chapter 1",
// base + 1 = "chapter 1043" (the day before), base + 2 = "chapter 1044" (the reveal).

/** A value in every language, each marked with the language it is in. */
function everyLanguage<T>(languages: string[], value: (code: string) => T): Record<string, T> {
  return Object.fromEntries(languages.map((code) => [code, value(code)]));
}

/** Saves a Devil Fruit draft with its image (multipart, like the editor) and returns its id. */
async function createFruitDraft(page: Page, body: Record<string, unknown>): Promise<string> {
  const response = await page.request.post('/api/content/devil-fruits', {
    multipart: {
      version: {
        name: 'version.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(body)),
      },
      image: fruitImage(),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}

test('Gomu Gomu reads as known at chapter 1, 1043 and 1044, and as the truth unfiltered', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const base = freshNumber();
  const [chapter1, chapter1043, chapter1044] = [base, base + 1, base + 2];
  const crew: Crew = {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
  const languages = await languageCodes(crew.editor);

  // The story: one saga, one arc, the three chapters online.
  const titled = translationsOf(languages, `E2E Spoiler ${base}`);
  const saga = await putOnline(crew, 'sagas', {
    number: base,
    translations: titled,
  });
  const arc = await putOnline(crew, 'arcs', {
    number: base,
    saga,
    translations: titled,
  });
  const chapterId: Record<number, string> = {};
  for (const number of [chapter1, chapter1043, chapter1044]) {
    chapterId[number] = await putOnline(crew, 'chapters', {
      number,
      arc,
      releases: [{ country: 'JP', date: '2020-05-01' }],
      translations: translationsOf(languages, `E2E Spoiler chapter ${number}`),
    });
  }
  const at = (number: number) => ({ chapter: chapterId[number] });

  // The types: the Paramecia met at chapter 1, the Zoan only at the reveal; its Mythical
  // subcategory has no first appearance of its own, so it is met with the Zoan.
  const typeText = (name: string) =>
    everyLanguage(languages, (code) => ({
      name: `${name} (${code})`,
      description: `${name} described in ${code}.`,
      advantages: `${name} advantages in ${code}.`,
      disadvantages: `${name} disadvantages in ${code}.`,
    }));
  const paramecia = await putOnline(crew, 'devil-fruit-types', {
    romaji: `E2E Paramecia ${base}`,
    translations: typeText(`E2E Paramecia ${base}`),
    firstAppearance: at(chapter1),
  });
  const zoan = await putOnline(crew, 'devil-fruit-types', {
    romaji: `E2E Zoan ${base}`,
    translations: typeText(`E2E Zoan ${base}`),
    subcategories: [
      {
        translations: everyLanguage(languages, (code) => ({
          name: `E2E Mythical ${base} (${code})`,
          description: `Mythical described in ${code}.`,
        })),
      },
    ],
    firstAppearance: at(chapter1044),
  });
  const zoanVersion = await crew.editor.request.get(
    `/api/content/devil-fruit-types/${zoan}/versions/1`,
  );
  const mythical: string = (await zoanVersion.json()).body.subcategories[0].id;

  // The fruit: the truth in its main fields, the Gomu Gomu as the initial knowledge, and one
  // reveal at chapter 1044 naming every field that changes (no value: it reveals the truth).
  const gomu = `E2E Gomu Gomu ${base}`;
  const nika = `E2E Hito Hito Nika ${base}`;
  const fruit = await createFruitDraft(crew.editor, {
    romaji: `${nika} no Mi`,
    type: zoan,
    subcategory: mythical,
    firstAppearance: at(chapter1),
    translations: everyLanguage(languages, (code) => ({
      name: `${nika} (${code})`,
      description: `The fruit of the sun god, in ${code}.`,
      advantages: `Frees its eater, in ${code}.`,
      disadvantages: `Tiring, in ${code}.`,
    })),
    initialKnowledge: {
      romaji: `${gomu} no Mi`,
      type: paramecia,
      translations: everyLanguage(languages, (code) => ({
        name: `${gomu} (${code})`,
        description: `Rubber, nothing more, in ${code}.`,
      })),
    },
    reveals: [
      {
        revealedAt: at(chapter1044),
        titles: everyLanguage(languages, (code) => `The fruit is Nika (${code})`),
        fields: ['name', 'romaji', 'type', 'description', 'disadvantages'],
      },
    ],
  });
  await approve(crew, 'devil-fruits', fruit);
  const published = await publish(crew, 'devil-fruits', fruit);
  expect(published.status(), await published.text()).toBe(200);

  const read = async (path: string) => {
    const response = await getPublic(request, path);
    expect(response.status(), path).toBe(200);
    return response.json();
  };
  const fruitAt = (chapter?: number) =>
    read(`${devilFruitPath('en', fruit)}${chapter === undefined ? '' : `?asOfChapter=${chapter}`}`);
  const asGomu = {
    name: `${gomu} (en)`,
    romaji: `${gomu} no Mi`,
    // The slug would give the romaji away: unknown until the romaji is.
    slug: null,
    description: 'Rubber, nothing more, in en.',
    advantages: 'Frees its eater, in en.',
    disadvantages: null,
    type: { id: paramecia },
    subcategory: null,
  };

  // Chapter 1 and the day before the reveal: the Gomu Gomu, a Paramecia; the Zoan unknown.
  for (const chapter of [chapter1, chapter1043]) {
    expect(await fruitAt(chapter), `chapter ${chapter}`).toMatchObject(asGomu);
    expect(
      (await getPublic(request, `${fruitTypePath('en', zoan)}?asOfChapter=${chapter}`)).status(),
    ).toBe(404);
  }

  // Chapter 1044 and no filter: the truth, a Mythical Zoan; the Zoan is met.
  const asNika = {
    name: `${nika} (en)`,
    romaji: `${nika} no Mi`,
    description: 'The fruit of the sun god, in en.',
    disadvantages: 'Tiring, in en.',
    type: { id: zoan },
    subcategory: { id: mythical },
  };
  const revealed = await fruitAt(chapter1044);
  expect(revealed).toMatchObject(asNika);
  expect(revealed.slug).not.toBeNull();
  expect(await fruitAt()).toMatchObject({ ...asNika, slug: revealed.slug });
  await read(`${fruitTypePath('en', zoan)}?asOfChapter=${chapter1044}`);

  // Before its first appearance the fruit itself does not exist for the reader.
  expect(
    (
      await getPublic(request, `${devilFruitPath('en', fruit)}?asOfChapter=${chapter1 - 1}`)
    ).status(),
  ).toBe(404);
});
