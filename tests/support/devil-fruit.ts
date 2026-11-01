import { paragraphsOf } from './paragraphs';

/** What the content API saves a Devil Fruit Type with; `chapter` is a content id. */
export function fruitTypeBody(
  languages: string[],
  draft: { romaji: string; name: string; chapter: string },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    firstAppearance: { chapter: draft.chapter },
    ...sectionsOf(languages, draft.name, draft.chapter),
    translations: namesOf(languages, draft.name),
  };
}

/** What the content API saves a Devil Fruit with; `type` and `chapter` are content ids. */
export function devilFruitBody(
  languages: string[],
  draft: {
    romaji: string;
    name: string;
    type: string;
    chapter: string;
    multipleUsers?: boolean;
  },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    type: draft.type,
    multipleUsers: draft.multipleUsers ?? false,
    firstAppearance: { chapter: draft.chapter },
    ...sectionsOf(languages, draft.name, draft.chapter),
    translations: namesOf(languages, draft.name),
  };
}

function namesOf(languages: string[], name: string) {
  return Object.fromEntries(languages.map((code) => [code, { name: `${name} (${code})` }]));
}

/** One paragraph per section, discovered at the first appearance, as review asks. */
function sectionsOf(languages: string[], name: string, chapter: string) {
  const section = (words: string) =>
    paragraphsOf(languages, (code) => `${name} ${words} in ${code}.`, { chapter });
  return {
    description: section('described'),
    advantages: section('advantages'),
    disadvantages: section('disadvantages'),
  };
}
