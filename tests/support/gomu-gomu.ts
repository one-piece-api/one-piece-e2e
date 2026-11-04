import { Page } from '@playwright/test';
import { chapterIdOf } from './bounty';
import { fruitTypeBody } from './devil-fruit';
import { paragraphsOf } from './paragraphs';
import {
  approve,
  arcOf,
  createDraft,
  Crew,
  freshNumber,
  languageCodes,
  onlineChapter,
  publish,
  putOnline,
  translationsOf,
} from './story';

/**
 * The reference case of the field reveals (reveals plan, section 1): the reader first believes the
 * fruit is the Gomu Gomu no Mi, a Paramecia; at a later chapter and episode the reader learns it is
 * the Hito Hito no Mi, Model: Nika, a Mythical Zoan. Chapter and episode numbers are unique
 * forever, so each run gets fresh ones, increasing in the order of the story: `first` is where the
 * fruit appears, `before` the day before the reveal, `reveal` where the reader learns the truth.
 */
export interface GomuGomu {
  languages: string[];
  chapter: Record<'first' | 'before' | 'reveal', number>;
  episode: Record<'first' | 'before' | 'reveal', number>;
  /** The content id of the fruit, online. */
  fruit: string;
  /** The content ids of the types: the believed Paramecia and the true Zoan. */
  paramecia: string;
  zoan: string;
  /** The id of the Zoan's Mythical subcategory. */
  mythical: string;
  /** The fruit as the reader first knows it, and as it truly is (name in English). */
  believedName: string;
  trueName: string;
  believedRomaji: string;
  /** The names of the two types, in English. */
  parameciaName: string;
  zoanName: string;
  trueRomaji: string;
  revealTitle: string;
}

/** Puts the fruit of the reference case online, with the chapters, episodes and types it needs. */
export async function putGomuGomuOnline(crew: Crew): Promise<GomuGomu> {
  const { editor } = crew;
  const languages = await languageCodes(editor);
  const stamp = Date.now();

  // Three chapters in one arc, then three episodes in it, in the order of the story.
  const firstChapter = await onlineChapter(crew);
  const firstChapterId = await chapterIdOf(editor, firstChapter);
  const arc = await arcOf(editor, firstChapterId);
  const chapterIds = [firstChapterId];
  const chapterNumbers = [firstChapter];
  for (const label of ['before', 'reveal']) {
    const number = freshNumber();
    chapterNumbers.push(number);
    chapterIds.push(
      await putOnline(crew, 'chapters', {
        number,
        arc,
        releases: [{ country: 'JP', date: '2020-05-01' }],
        translations: translationsOf(languages, `E2E Gomu ${label} chapter ${number}`),
      }),
    );
  }
  const episodeIds: string[] = [];
  const episodeNumbers: number[] = [];
  for (const label of ['first', 'before', 'reveal']) {
    const number = freshNumber();
    episodeNumbers.push(number);
    episodeIds.push(
      await putOnline(crew, 'episodes', {
        number,
        arc,
        japaneseTitle: `E2E ${number}`,
        broadcasts: [{ country: 'JP', date: '2022-02-02' }],
        translations: translationsOf(languages, `E2E Gomu ${label} episode ${number}`),
      }),
    );
  }
  const at = (index: number) => ({
    chapter: chapterIds[index],
    episode: episodeIds[index],
  });

  const sectionOf = (name: string, words: string, index: number) =>
    paragraphsOf(languages, (code) => `${name} ${stamp} ${words} in ${code}.`, at(index));

  // The types: the Paramecia met with the fruit, the Zoan only at the reveal, with its Mythical
  // subcategory (met with it).
  const paramecia = await putOnline(crew, 'devil-fruit-types', {
    ...fruitTypeBody(languages, {
      romaji: `E2E Paramecia ${stamp}-kei`,
      name: `E2E Paramecia ${stamp}`,
      chapter: chapterIds[0],
    }),
    firstAppearance: at(0),
    description: sectionOf('E2E Paramecia', 'described', 0),
    advantages: sectionOf('E2E Paramecia', 'advantages', 0),
    disadvantages: sectionOf('E2E Paramecia', 'disadvantages', 0),
  });
  const zoanBody = fruitTypeBody(languages, {
    romaji: `E2E Zoan ${stamp}-kei`,
    name: `E2E Zoan ${stamp}`,
    chapter: chapterIds[2],
  });
  const zoan = await putOnline(crew, 'devil-fruit-types', {
    ...zoanBody,
    firstAppearance: at(2),
    // A section's paragraph is discovered at the first appearance on every axis it has.
    description: sectionOf('E2E Zoan', 'described', 2),
    advantages: sectionOf('E2E Zoan', 'advantages', 2),
    disadvantages: sectionOf('E2E Zoan', 'disadvantages', 2),
    subcategories: [
      {
        translations: Object.fromEntries(
          languages.map((code) => [
            code,
            {
              name: `E2E Mythical ${stamp} (${code})`,
              description: `Mythical described in ${code}.`,
            },
          ]),
        ),
      },
    ],
  });
  const mythical: string = (await versionBody(editor, 'devil-fruit-types', zoan)).subcategories[0]
    .id;

  // The fruit: the truth in its main fields, the Gomu Gomu as the initial knowledge, one reveal.
  const believedName = `E2E Gomu Gomu ${stamp}`;
  const trueName = `E2E Hito Hito Nika ${stamp}`;
  const revealTitle = 'The fruit is Nika';
  const section = (words: string) =>
    paragraphsOf(languages, (code) => `${trueName} ${words} in ${code}.`, at(0));
  const fruit = await createDraft(editor, 'devil-fruits', {
    romaji: `${trueName} no Mi`,
    type: zoan,
    subcategory: mythical,
    multipleUsers: false,
    firstAppearance: at(0),
    description: section('described'),
    advantages: section('advantages'),
    disadvantages: section('disadvantages'),
    translations: Object.fromEntries(
      languages.map((code) => [code, { name: `${trueName} (${code})` }]),
    ),
    initialKnowledge: {
      romaji: `${believedName} no Mi`,
      type: paramecia,
      translations: Object.fromEntries(
        languages.map((code) => [code, { name: `${believedName} (${code})` }]),
      ),
    },
    reveals: [
      {
        revealedAt: at(2),
        titles: Object.fromEntries(languages.map((code) => [code, `${revealTitle} (${code})`])),
        fields: ['NAME', 'ROMAJI', 'TYPE'],
      },
    ],
  });
  await approve(crew, 'devil-fruits', fruit);
  const published = await publish(crew, 'devil-fruits', fruit);
  if (published.status() !== 200) {
    throw new Error(`the Gomu Gomu would not go online: ${await published.text()}`);
  }

  return {
    languages,
    chapter: {
      first: chapterNumbers[0],
      before: chapterNumbers[1],
      reveal: chapterNumbers[2],
    },
    episode: {
      first: episodeNumbers[0],
      before: episodeNumbers[1],
      reveal: episodeNumbers[2],
    },
    fruit,
    paramecia,
    zoan,
    mythical,
    believedName: `${believedName} (en)`,
    trueName: `${trueName} (en)`,
    believedRomaji: `${believedName} no Mi`,
    parameciaName: `E2E Paramecia ${stamp} (en)`,
    zoanName: `E2E Zoan ${stamp} (en)`,
    trueRomaji: `${trueName} no Mi`,
    revealTitle: `${revealTitle} (en)`,
  };
}

/** The body of version 1 of a content, as the content API keeps it. */
async function versionBody(page: Page, entity: string, id: string) {
  const response = await page.request.get(`/api/content/${entity}/${id}/versions/1`);
  return (await response.json()).body;
}
