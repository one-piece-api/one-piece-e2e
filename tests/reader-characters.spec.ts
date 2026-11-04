import { APIRequestContext, expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import {
  characterPath,
  devilFruitPath,
  getPublic,
  PublicCharacter,
  PublicCharacterSummary,
  PublicDevilFruitDetail,
} from './support/public-api';
import {
  putReferenceCharactersOnline,
  ReferenceCharacters,
  StoryLabel,
} from './support/reader-characters';

// The reference characters of the reveals plan (section 1) read from the public API as the
// reader knows them (workflow 3.7, 3.8; plan D4, D5, D7, D8, D12): Usopp's two periods in the crew,
// Koby's two ranks, Ace's fruit and death, Sabo's fruit and return. Each case is read on both
// axes, each on its own: a point shows only its part on the axis read.

const AXES = [
  { name: 'chapter', param: 'asOfChapter' },
  { name: 'episode', param: 'asOfEpisode' },
] as const;
type Axis = (typeof AXES)[number];

test.describe.serial('the reference characters are read as the reader knows them', () => {
  let story: ReferenceCharacters;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    story = await putReferenceCharactersOnline({
      editor: await signIn(browser, 'chopper'),
      reviewer: await signIn(browser, 'zoro'),
      publisher: await signIn(browser, 'vivi'),
    });
  });

  /** The number of a point on an axis: what the filter asks for. */
  const numberAt = (axis: Axis, label: StoryLabel) => story.point[label][axis.name];

  /** A point as the reader sees it on one axis: the other axis is not shown. */
  const seenAt = (axis: Axis, label: StoryLabel) => ({
    chapter: axis.name === 'chapter' ? story.point[label].chapter : null,
    episode: axis.name === 'episode' ? story.point[label].episode : null,
  });

  async function read(request: APIRequestContext, path: string) {
    const response = await getPublic(request, path);
    expect(response.status(), path).toBe(200);
    return response.json();
  }

  const characterAt = (
    request: APIRequestContext,
    id: string,
    axis: Axis,
    label: StoryLabel,
  ): Promise<PublicCharacter> =>
    read(request, `${characterPath('en', id)}?${axis.param}=${numberAt(axis, label)}`);

  for (const axis of AXES) {
    test(`${axis.name}: Usopp leaves the crew at Water 7 and is back after Enies Lobby`, async ({
      request,
    }) => {
      const membership = async (label: StoryLabel) =>
        (await characterAt(request, story.usopp, axis, label)).affiliations[0];

      // The debut: one period, current; its end is the reader's future.
      const debut = await membership('debut');
      expect(debut.former).toBe(false);
      expect(debut.periods).toHaveLength(1);
      expect(debut.periods[0]).toMatchObject({
        role: story.usoppRoles[0],
        former: false,
        discovered: seenAt(axis, 'debut'),
        ended: null,
      });

      // Water 7: the first period ends, and no other has begun: the membership is former.
      const away = await membership('water7');
      expect(away.former).toBe(true);
      expect(away.periods).toHaveLength(1);
      expect(away.periods[0]).toMatchObject({ former: true, ended: seenAt(axis, 'water7') });

      // After Enies Lobby: both periods, the first former and the second current.
      const back = await membership('enies');
      expect(back.former).toBe(false);
      expect(back.periods.map(({ role, former }) => [role, former])).toEqual([
        [story.usoppRoles[0], true],
        [story.usoppRoles[1], false],
      ]);
      expect(back.periods[1].discovered).toEqual(seenAt(axis, 'enies'));
    });

    test(`${axis.name}: Koby is a Seaman Recruit until Enies Lobby, then a Captain`, async ({
      request,
    }) => {
      const membership = async (label: StoryLabel) =>
        (await characterAt(request, story.koby, axis, label)).affiliations[0];

      const early = await membership('water7');
      expect(early.affiliation.kind).toBe('NAVY');
      expect(early.periods.map(({ marineRank, former }) => [marineRank, former])).toEqual([
        ['SEAMAN_RECRUIT', false],
      ]);

      const promoted = await membership('enies');
      expect(promoted.former).toBe(false);
      expect(promoted.periods.map(({ marineRank, former }) => [marineRank, former])).toEqual([
        ['SEAMAN_RECRUIT', true],
        ['CAPTAIN', false],
      ]);
    });

    test(`${axis.name}: Ace has the fruit until Marineford, where the reader learns he is dead`, async ({
      request,
    }) => {
      // The day before: alive, with the fruit.
      const alive = await characterAt(request, story.ace, axis, 'enies');
      expect(alive.status).toBe('ALIVE');
      expect(alive.devilFruits.map(({ devilFruit, former }) => [devilFruit.id, former])).toEqual([
        [story.mera, false],
      ]);

      // Marineford: dead, and the fruit is no longer his; the window shows where it ended.
      const dead = await characterAt(request, story.ace, axis, 'marineford');
      expect(dead.status).toBe('DECEASED');
      expect(dead.devilFruits[0]).toMatchObject({
        former: true,
        discovered: seenAt(axis, 'debut'),
        ended: seenAt(axis, 'marineford'),
      });
    });

    test(`${axis.name}: Sabo is believed dead from his first appearance until Dressrosa`, async ({
      request,
    }) => {
      // Before his first appearance he does not exist for the reader.
      const unknown = await getPublic(
        request,
        `${characterPath('en', story.sabo)}?${axis.param}=${numberAt(axis, 'debut')}`,
      );
      expect(unknown.status()).toBe(404);

      // Marineford: believed dead, no fruit yet - and not Ace's rival for it.
      const believed = await characterAt(request, story.sabo, axis, 'marineford');
      expect(believed.status).toBe('DECEASED');
      expect(believed.description.map(({ text }) => text)).toEqual([story.saboBelievedDead]);
      expect(believed.devilFruits).toEqual([]);

      // Dressrosa: alive, the believed-dead paragraph superseded, and the fruit his.
      const alive = await characterAt(request, story.sabo, axis, 'dressrosa');
      expect(alive.status).toBe('ALIVE');
      expect(alive.description.map(({ text }) => text)).toEqual([story.saboAlive]);
      expect(alive.devilFruits.map(({ devilFruit, former }) => [devilFruit.id, former])).toEqual([
        [story.mera, false],
      ]);
    });

    test(`${axis.name}: the fruit has one current user at a time, and the list follows it`, async ({
      request,
    }) => {
      const fruitAt = async (label: StoryLabel): Promise<PublicDevilFruitDetail> =>
        read(request, `${devilFruitPath('en', story.mera)}?${axis.param}=${numberAt(axis, label)}`);
      const users = async (label: StoryLabel) =>
        (await fruitAt(label)).users.map(({ character, former }) => [character.id, former]);
      const currentUsers = async (label: StoryLabel) => {
        const listed = await read(
          request,
          `${characterPath('en')}?devilFruit=${story.mera}&${axis.param}=${numberAt(axis, label)}`,
        );
        return (listed.content as PublicCharacterSummary[]).map(({ id }) => id);
      };

      // Ace, then nobody (his window ended, Sabo's not yet begun), then Sabo - Ace is history.
      expect(await users('enies')).toEqual([[story.ace, false]]);
      expect(await currentUsers('enies')).toEqual([story.ace]);
      expect(await users('marineford')).toEqual([[story.ace, true]]);
      expect(await currentUsers('marineford')).toEqual([]);
      expect(await users('dressrosa')).toEqual([
        [story.sabo, false],
        [story.ace, true],
      ]);
      expect(await currentUsers('dressrosa')).toEqual([story.sabo]);
    });
  }

  test('without a filter: the truth, every point on both axes, and no ended paragraph', async ({
    request,
  }) => {
    const usopp: PublicCharacter = await read(request, characterPath('en', story.usopp));
    expect(usopp.affiliations[0].former).toBe(false);
    expect(usopp.affiliations[0].periods[0].ended).toEqual({
      chapter: story.point.water7.chapter,
      episode: story.point.water7.episode,
    });

    const ace: PublicCharacter = await read(request, characterPath('en', story.ace));
    expect(ace.status).toBe('DECEASED');
    expect(ace.devilFruits[0].former).toBe(true);

    const sabo: PublicCharacter = await read(request, characterPath('en', story.sabo));
    expect(sabo.status).toBe('ALIVE');
    expect(sabo.description.map(({ text }) => text)).toEqual([story.saboAlive]);
  });
});
