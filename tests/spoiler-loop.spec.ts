import { APIRequestContext, expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { GomuGomu, putGomuGomuOnline } from './support/gomu-gomu';
import { devilFruitPath, fruitTypePath, getPublic } from './support/public-api';

// The spoiler loop (reveals plan R10): the Gomu Gomu of the reference case, believed to be a
// Paramecia and revealed as the Hito Hito no Mi, Model: Nika, a Mythical Zoan - written and
// published through the content API, then read from the public API as the reader knows it at
// each chapter and each episode (workflow 3.7, 3.8; plan D12, D13). Both axes are read on their
// own: the story has no chapter-to-episode mapping.

/** Where a reader is: the query string of the filter on one axis. */
type Axis = 'asOfChapter' | 'asOfEpisode';

test.describe.serial('the Gomu Gomu is read as the reader knows it', () => {
  let gomu: GomuGomu;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    gomu = await putGomuGomuOnline({
      editor: await signIn(browser, 'chopper'),
      reviewer: await signIn(browser, 'zoro'),
      publisher: await signIn(browser, 'vivi'),
    });
  });

  async function read(request: APIRequestContext, path: string) {
    const response = await getPublic(request, path);
    expect(response.status(), path).toBe(200);
    return response.json();
  }

  const fruitAt = (request: APIRequestContext, axis?: Axis, number?: number) =>
    read(request, `${devilFruitPath('en', gomu.fruit)}${axis ? `?${axis}=${number}` : ''}`);

  const asBelieved = () => ({
    name: gomu.believedName,
    romaji: gomu.believedRomaji,
    type: { id: gomu.paramecia },
    subcategory: null,
  });
  const asTrue = () => ({
    name: gomu.trueName,
    romaji: gomu.trueRomaji,
    type: { id: gomu.zoan },
    subcategory: { id: gomu.mythical },
  });

  for (const [axis, label] of [
    ['asOfChapter', 'chapter'],
    ['asOfEpisode', 'episode'],
  ] as const) {
    test(`at each ${label}: the believed fruit, then the truth from the reveal on`, async ({
      request,
    }) => {
      const points = label === 'chapter' ? gomu.chapter : gomu.episode;

      // The first appearance and the day before the reveal: the Gomu Gomu, a Paramecia.
      for (const number of [points.first, points.before]) {
        const fruit = await fruitAt(request, axis, number);
        expect(fruit, `${label} ${number}`).toMatchObject(asBelieved());
        expect(fruit.reveals, `${label} ${number}`).toEqual([]);
        // The Zoan is a content the reader has not met: no page, no link.
        expect(
          (
            await getPublic(request, `${fruitTypePath('en', gomu.zoan)}?${axis}=${number}`)
          ).status(),
        ).toBe(404);
      }

      // The reveal and the truth without a filter: the Hito Hito no Mi, Model: Nika.
      const revealed = await fruitAt(request, axis, points.reveal);
      expect(revealed).toMatchObject(asTrue());
      expect(revealed.reveals).toHaveLength(1);
      expect(revealed.reveals[0].title).toBe(gomu.revealTitle);
      expect(revealed.reveals[0].fields).toEqual(['NAME', 'ROMAJI', 'TYPE']);
      await read(request, `${fruitTypePath('en', gomu.zoan)}?${axis}=${points.reveal}`);
      expect(await fruitAt(request)).toMatchObject(asTrue());
    });

    test(`${label}: before the first appearance the fruit does not exist for the reader`, async ({
      request,
    }) => {
      const points = label === 'chapter' ? gomu.chapter : gomu.episode;

      const before = await getPublic(
        request,
        `${devilFruitPath('en', gomu.fruit)}?${axis}=${points.first - 1}`,
      );
      expect(before.status()).toBe(404);
    });
  }

  test('without a filter the fruit carries what a client needs to build its own', async ({
    request,
  }) => {
    const fruit = await fruitAt(request);

    expect(fruit.initialKnowledge).toMatchObject({
      name: gomu.believedName,
      romaji: gomu.believedRomaji,
      type: { id: gomu.paramecia },
    });
    expect(fruit.reveals).toHaveLength(1);
    expect(fruit.reveals[0].revealed).toEqual({
      chapter: gomu.chapter.reveal,
      episode: gomu.episode.reveal,
    });
    expect(fruit.reveals[0]).toMatchObject({ name: gomu.trueName, type: { id: gomu.zoan } });
  });

  test('the slug is the one the reader knows at N; a slug of the future is unknown', async ({
    request,
  }) => {
    const truth = await fruitAt(request);
    const believedSlug: string = truth.initialKnowledge.slug;
    const trueSlug: string = truth.slug;
    expect(believedSlug).not.toBe(trueSlug);
    const before = gomu.chapter.before;
    const reveal = gomu.chapter.reveal;

    // The day before the reveal the fruit is its believed name, and so is its slug.
    const known = await fruitAt(request, 'asOfChapter', before);
    expect(known.slug).toBe(believedSlug);
    expect(
      (
        await getPublic(request, `${devilFruitPath('en', trueSlug)}?asOfChapter=${before}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await getPublic(request, `${devilFruitPath('en', believedSlug)}?asOfChapter=${before}`)
      ).status(),
    ).toBe(200);

    // From the reveal on, the old slug leads to the new one and the redirect keeps the filter.
    const moved = await getPublic(
      request,
      `${devilFruitPath('en', believedSlug)}?asOfChapter=${reveal}`,
    );
    expect(moved.status()).toBe(301);
    const location = moved.headers()['location'];
    expect(location).toContain(trueSlug);
    expect(location).toContain(`asOfChapter=${reveal}`);

    // Without a filter, the truth: its slug serves, the believed one redirects to it.
    expect((await getPublic(request, devilFruitPath('en', trueSlug))).status()).toBe(200);
    const unfiltered = await getPublic(request, devilFruitPath('en', believedSlug));
    expect(unfiltered.status()).toBe(301);
    expect(unfiltered.headers()['location']).toContain(trueSlug);
  });

  test('search reads the name at N, and both axes at once are refused', async ({ request }) => {
    const believedWords = gomu.believedName.replace(/ \(en\)$/, '');
    const trueWords = gomu.trueName.replace(/ \(en\)$/, '');
    const idsFor = async (words: string, axis: Axis, number: number) => {
      const found = await read(
        request,
        `${devilFruitPath('en')}?q=${encodeURIComponent(words)}&${axis}=${number}`,
      );
      return found.content.map((listed: { id: string }) => listed.id);
    };

    // Before the reveal the fruit is found by the name the reader knows, not by the real one.
    expect(await idsFor(believedWords, 'asOfChapter', gomu.chapter.before)).toContain(gomu.fruit);
    expect(await idsFor(trueWords, 'asOfChapter', gomu.chapter.before)).not.toContain(gomu.fruit);
    // From the reveal on it is the other way round.
    expect(await idsFor(trueWords, 'asOfChapter', gomu.chapter.reveal)).toContain(gomu.fruit);
    expect(await idsFor(believedWords, 'asOfChapter', gomu.chapter.reveal)).not.toContain(
      gomu.fruit,
    );

    const both = await getPublic(
      request,
      `${devilFruitPath('en', gomu.fruit)}?asOfChapter=${gomu.chapter.first}&asOfEpisode=${gomu.episode.first}`,
    );
    expect(both.status()).toBe(400);
    expect((await both.json()).errorCode).toBe('VALIDATION_FAILED');
  });
});
