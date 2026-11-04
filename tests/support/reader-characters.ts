import { affiliationBody } from './affiliation';
import { characterBody, inLanguage, StoryPointBody } from './character';
import { devilFruitBody, fruitTypeBody } from './devil-fruit';
import { paragraphsOf } from './paragraphs';
import { approve, createDraft, Crew, publish, putOnline } from './story';
import { putStoryPointsOnline, StoryPoint } from './story-points';

/**
 * The reference characters of the reveals plan (section 1), read as the reader knows them at
 * each point of one story. The points, in order: `debut` (everyone but Sabo appears), `water7`
 * (Usopp leaves the crew; Sabo appears, believed dead), `enies` (Usopp is back; Koby is promoted),
 * `marineford` (Ace's window and life end), `dressrosa` (Sabo is alive and eats the fruit).
 */
export const STORY = ['debut', 'water7', 'enies', 'marineford', 'dressrosa'] as const;
export type StoryLabel = (typeof STORY)[number];

export interface ReferenceCharacters {
  languages: string[];
  /** The points of the story, by label: the chapter and the episode of each. */
  point: Record<StoryLabel, StoryPoint>;
  /** The content ids, online. */
  usopp: string;
  koby: string;
  ace: string;
  sabo: string;
  mera: string;
  strawHats: string;
  marines: string;
  /** The texts the reader reads, in English. */
  usoppRoles: [string, string];
  saboBelievedDead: string;
  saboAlive: string;
}

/** Puts the story and the four characters online. */
export async function putReferenceCharactersOnline(crew: Crew): Promise<ReferenceCharacters> {
  const { languages, points } = await putStoryPointsOnline(crew, [...STORY]);
  const stamp = Date.now();
  const point = Object.fromEntries(STORY.map((label, index) => [label, points[index]])) as Record<
    StoryLabel,
    StoryPoint
  >;
  const at = (label: StoryLabel): StoryPointBody => ({
    chapter: point[label].chapterId,
    episode: point[label].episodeId,
  });
  const section = (name: string, words: string, label: StoryLabel) =>
    paragraphsOf(languages, (code) => `${name} ${words} in ${code}.`, at(label));
  const titles = (title: string) =>
    Object.fromEntries(languages.map((code) => [code, inLanguage(title, code)]));
  const text = (words: string) =>
    Object.fromEntries(languages.map((code) => [code, inLanguage(words, code)]));

  // Two groups, a type and the fruit of Ace and Sabo: all met at the debut, on both axes.
  const group = (name: string, kind: string) =>
    putOnline(crew, 'affiliations', {
      ...affiliationBody(languages, {
        romaji: `E2E ${name} ${stamp}`,
        kind,
        name: `E2E ${name} ${stamp}`,
        chapter: point.debut.chapterId,
      }),
      firstAppearance: at('debut'),
      description: section(`E2E ${name} ${stamp}`, 'described', 'debut'),
    });
  const strawHats = await group('Straw Hats', 'PIRATE_CREW');
  const marines = await group('Marines', 'NAVY');
  const type = await putOnline(crew, 'devil-fruit-types', {
    ...fruitTypeBody(languages, {
      romaji: `E2E Logia ${stamp}-kei`,
      name: `E2E Logia ${stamp}`,
      chapter: point.debut.chapterId,
    }),
    firstAppearance: at('debut'),
    description: section(`E2E Logia ${stamp}`, 'described', 'debut'),
    advantages: section(`E2E Logia ${stamp}`, 'advantages', 'debut'),
    disadvantages: section(`E2E Logia ${stamp}`, 'disadvantages', 'debut'),
  });
  const mera = await putOnline(crew, 'devil-fruits', {
    ...devilFruitBody(languages, {
      romaji: `E2E Mera Mera ${stamp} no Mi`,
      name: `E2E Mera Mera ${stamp}`,
      type,
      chapter: point.debut.chapterId,
    }),
    firstAppearance: at('debut'),
    description: section(`E2E Mera ${stamp}`, 'described', 'debut'),
    advantages: section(`E2E Mera ${stamp}`, 'advantages', 'debut'),
    disadvantages: section(`E2E Mera ${stamp}`, 'disadvantages', 'debut'),
  });

  /** A character first appearing at `first`, with what the label says on top. */
  const character = (name: string, first: StoryLabel, more: Record<string, unknown>) => ({
    ...characterBody(languages, {
      romaji: `E2E ${name} ${stamp}`,
      name: `E2E ${name} ${stamp}`,
      chapter: point[first].chapterId,
      episode: point[first].episodeId,
    }),
    ...more,
  });
  const reveal = (label: StoryLabel, title: string, fields: string[]) => ({
    revealedAt: at(label),
    titles: titles(title),
    fields,
  });

  // Usopp: leaves the crew at Water 7 and is back after Enies Lobby - two periods, one ended.
  const usoppRoles: [string, string] = ['Sniper', 'Brave Warrior of the Sea'];
  const usopp = await putOnline(
    crew,
    'characters',
    character('Usopp', 'debut', {
      affiliations: [
        {
          affiliation: strawHats,
          periods: [
            { role: text(usoppRoles[0]), discovered: at('debut'), ended: at('water7') },
            { role: text(usoppRoles[1]), discovered: at('enies') },
          ],
        },
      ],
    }),
  );

  // Koby: in the Navy all along, a Seaman Recruit until Enies Lobby, then a Captain.
  const koby = await putOnline(
    crew,
    'characters',
    character('Koby', 'debut', {
      affiliations: [
        {
          affiliation: marines,
          periods: [
            { marineRank: 'SEAMAN_RECRUIT', discovered: at('debut'), ended: at('enies') },
            { marineRank: 'CAPTAIN', discovered: at('enies') },
          ],
        },
      ],
    }),
  );

  // Ace: has the fruit from the debut until Marineford, where the reader learns he is dead.
  const ace = await putOnline(
    crew,
    'characters',
    character('Ace', 'debut', {
      status: 'DECEASED',
      devilFruits: [{ devilFruit: mera, discovered: at('debut'), ended: at('marineford') }],
      initialKnowledge: { status: 'ALIVE' },
      reveals: [reveal('marineford', 'Ace is dead', ['STATUS'])],
    }),
  );

  // Sabo: believed dead from his first appearance, until Dressrosa, where he is alive and has
  // the fruit - his window starts where Ace's ended, which does not overlap it.
  const saboBelievedDead = 'Sabo is believed dead';
  const saboAlive = 'Sabo is alive';
  const sabo = await createDraft(
    crew.editor,
    'characters',
    character('Sabo', 'water7', {
      status: 'ALIVE',
      devilFruits: [{ devilFruit: mera, discovered: at('dressrosa') }],
      initialKnowledge: { status: 'DECEASED' },
      reveals: [reveal('dressrosa', 'Sabo is alive', ['STATUS'])],
      description: [
        {
          text: text(saboBelievedDead),
          discovered: at('water7'),
          ended: at('dressrosa'),
        },
        { text: text(saboAlive), discovered: at('dressrosa'), ended: null },
      ],
    }),
  );
  await approve(crew, 'characters', sabo);
  const published = await publish(crew, 'characters', sabo);
  if (published.status() !== 200) {
    throw new Error(`Sabo would not go online: ${await published.text()}`);
  }

  return {
    languages,
    point,
    usopp,
    koby,
    ace,
    sabo,
    mera,
    strawHats,
    marines,
    usoppRoles: [inLanguage(usoppRoles[0], 'en'), inLanguage(usoppRoles[1], 'en')],
    saboBelievedDead: inLanguage(saboBelievedDead, 'en'),
    saboAlive: inLanguage(saboAlive, 'en'),
  };
}
